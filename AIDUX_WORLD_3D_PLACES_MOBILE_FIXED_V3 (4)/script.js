document.addEventListener("DOMContentLoaded", () => {

    const burger = document.querySelector(".burger");
    const nav = document.querySelector(".nav-links");

    if (burger && nav) {
        burger.addEventListener("click", () => {
            nav.classList.toggle("active");
        });
    }

    document.querySelectorAll(".hidden").forEach((el, i) => {
        setTimeout(() => el.classList.add("visible"), i * 200);
    });

    const form = document.getElementById("form");
    const msg = document.getElementById("msg");

    if (form && msg) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            msg.style.display = "block";
            form.reset();
        });
    }

});