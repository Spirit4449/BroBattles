const months = require("../../../../content/patch-notes.json");
const { escapeHtml: escape } = require("../../../shared/site/html.cjs");

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function renderPatchNotes() {
  const links = [];
  const sections = months.map(({ month, entries }) => {
    const label = monthFormat.format(new Date(month + "-01T00:00:00Z"));
    const id = "patch-" + month;
    links.push(`<a href="#${id}">${label}</a>`);
    const notes = entries.map(({ day, title, text, image, details }) => {
      const date = month + "-" + day;
      return `<details class="patch-entry"><summary>
        <span class="patch-copy"><time datetime="${date}">${label.split(" ")[0]} ${Number(day)}</time>
          <strong>${escape(title)}</strong><span>${escape(text)}</span></span>
        ${image ? `<img src="${escape(image)}" width="132" height="84" alt=""/>` : ""}
        <span class="patch-toggle" aria-hidden="true"></span></summary>
        <ul>${details.map(line => `<li>${escape(line)}</li>`).join("")}</ul></details>`;
    }).join("");
    return `<section class="site-frame patch-month" id="${id}" aria-labelledby="${id}-heading">
      <h2 id="${id}-heading">${label}</h2>${notes}</section>`;
  });
  return `<header class="site-intro release-heading"><h1>Patch Notes</h1></header>
    <div class="patch-layout"><nav class="site-frame patch-index" aria-label="Jump to month"><strong>Archive</strong>${links.join("")}</nav>
    <div class="patch-history">${sections.join("")}</div></div>`;
}
module.exports = { renderPatchNotes };
