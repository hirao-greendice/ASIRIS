"use strict";

const teachButton = document.querySelector("#teach-button");
const teachModal = document.querySelector("#teach-modal");
const modalContent = teachModal.querySelector(".teach-modal__content");

function openTeachModal() {
  teachModal.hidden = false;
  teachModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");
  modalContent.focus();
}

function closeTeachModal() {
  teachModal.hidden = true;
  teachModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");
  teachButton.focus();
}

teachButton.addEventListener("click", openTeachModal);

teachModal.addEventListener("click", (event) => {
  if (event.target === teachModal) closeTeachModal();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !teachModal.hidden) {
    closeTeachModal();
  }
});
