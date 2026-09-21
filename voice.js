const voiceBtn=document.getElementById("voiceBtn");
const voiceText=document.getElementById("voiceText");

let rec;

if(window.SpeechRecognition||window.webkitSpeechRecognition){

rec=new (window.SpeechRecognition||window.webkitSpeechRecognition)();
rec.lang="ru-RU";

rec.onresult=(e)=>{
const t=e.results[0][0].transcript.toLowerCase();

const map={
"привет":"Привет",
"карта":()=>location.href="map.html",
"камера":()=>location.href="camera.html"
};

for(let k in map){
if(t.includes(k)){
if(typeof map[k]=="function") map[k]();
else speak(map[k]);
return;
}
}

speak("Не понял");
};

voiceBtn.onclick=()=>rec.start();
}

function speak(t){
voiceText.textContent=t;
speechSynthesis.speak(new SpeechSynthesisUtterance(t));
}