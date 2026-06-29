export type DialogField = {
  name: string;
  label: string;
  type?: "text" | "date" | "textarea";
  required?: boolean;
  maxLength?: number;
};

const overlay = document.getElementById("dialog") as HTMLDivElement;
const form = document.getElementById("dialog-form") as HTMLFormElement;
const titleEl = document.getElementById("dialog-title") as HTMLHeadingElement;
const fieldsEl = document.getElementById("dialog-fields") as HTMLDivElement;
const errorEl = form.querySelector(".dialog-error") as HTMLParagraphElement;
const cancelBtn = document.getElementById("dialog-cancel") as HTMLButtonElement;

/**
 * Ouvre une boîte de dialogue modale et résout avec les valeurs saisies,
 * ou null si l'utilisateur annule.
 */
export function openDialog(
  title: string,
  fields: DialogField[],
  onSubmit: (values: Record<string, string>) => Promise<void>,
): void {
  titleEl.textContent = title;
  errorEl.classList.add("hidden");
  fieldsEl.innerHTML = "";

  for (const field of fields) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = field.label;
    label.appendChild(span);
    const input =
      field.type === "textarea"
        ? document.createElement("textarea")
        : document.createElement("input");
    input.name = field.name;
    if (field.required) input.required = true;
    if (field.maxLength) input.maxLength = field.maxLength;
    if (input instanceof HTMLInputElement) input.type = field.type === "date" ? "date" : "text";
    if (input instanceof HTMLTextAreaElement) input.rows = 3;
    label.appendChild(input);
    fieldsEl.appendChild(label);
  }

  overlay.classList.remove("hidden");
  (fieldsEl.querySelector("input, textarea") as HTMLElement | null)?.focus();

  const close = () => {
    overlay.classList.add("hidden");
    form.onsubmit = null;
    cancelBtn.onclick = null;
  };

  cancelBtn.onclick = () => close();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const values: Record<string, string> = {};
    for (const field of fields) values[field.name] = String(data.get(field.name) ?? "").trim();
    errorEl.classList.add("hidden");
    try {
      await onSubmit(values);
      close();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "Une erreur est survenue.";
      errorEl.classList.remove("hidden");
    }
  };
}
