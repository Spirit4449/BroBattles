export function renderAccountAccess(root, isGuest) {
  if (!root) return;
  const member = root.querySelector("[data-account-member]");
  const guestCard = root.querySelector("[data-account-guest]");
  if (member) {
    member.hidden = isGuest;
    member.querySelectorAll("button, input").forEach((control) => {
      control.disabled = isGuest;
    });
    if (isGuest) {
      member.querySelectorAll("form").forEach((form) => { form.hidden = true; });
      member.querySelectorAll("[data-account-toggle]").forEach((button) => {
        button.setAttribute("aria-expanded", "false");
      });
      member.querySelectorAll('input[type="password"]').forEach((input) => {
        input.value = "";
      });
    }
  }
  if (guestCard) guestCard.hidden = !isGuest;
}

export function wireAccountSettings(root) {
  const editors = Array.from(root?.querySelectorAll("[data-account-toggle]") || [])
    .map((button) => ({
      button,
      form: document.getElementById(button.getAttribute("aria-controls")),
    }))
    .filter(({ form }) => form);

  const close = (formId) => {
    editors.forEach(({ button, form }) => {
      if (formId && form.id !== formId) return;
      const restoreFocus = form.contains(document.activeElement);
      form.hidden = true;
      button.setAttribute("aria-expanded", "false");
      form.querySelectorAll('input[type="password"]').forEach((input) => {
        input.value = "";
      });
      if (restoreFocus) button.focus();
    });
  };

  editors.forEach(({ button, form }) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const shouldOpen = form.hidden;
      close();
      if (!shouldOpen) return;
      form.hidden = false;
      button.setAttribute("aria-expanded", "true");
      form.querySelector("input")?.focus();
    });
    form.querySelector("[data-account-cancel]")?.addEventListener("click", () => {
      close(form.id);
    });
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(form.id);
    });
  });

  return { close };
}
