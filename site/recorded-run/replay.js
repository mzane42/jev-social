const stepElements = [...document.querySelectorAll("[data-replay-step]")];
const replayButton = document.querySelector("[data-replay-button]");
const status = document.querySelector("[data-replay-status]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const phases = [1, 2, 3, 4, 5];

let timers = [];

function clearReplay() {
  for (const timer of timers) window.clearTimeout(timer);
  timers = [];
  for (const element of stepElements) {
    element.classList.remove("is-visible");
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
  }
}

function revealStep(step) {
  for (const element of stepElements) {
    if (Number(element.dataset.replayStep) !== step) continue;
    element.removeAttribute("aria-hidden");
    element.inert = false;
    element.classList.add("is-visible");
  }
}

function finishReplay() {
  status.textContent = "Recorded replay complete · 63.969 seconds in the original run.";
  replayButton.disabled = false;
  replayButton.textContent = "Replay the recorded run ↻";
}

function showCompleteReplay() {
  for (const step of phases) revealStep(step);
  finishReplay();
}

function playReplay() {
  clearReplay();
  replayButton.disabled = true;
  replayButton.textContent = "Replaying preserved run…";
  status.textContent = "Replaying the preserved run structure.";

  if (reducedMotion.matches) {
    showCompleteReplay();
    return;
  }

  phases.forEach((step, index) => {
    const timer = window.setTimeout(() => {
      revealStep(step);
      if (step === phases.at(-1)) finishReplay();
    }, 340 + index * 520);
    timers.push(timer);
  });
}

document.documentElement.classList.add("replay-enhanced");
replayButton.addEventListener("click", playReplay);
showCompleteReplay();
