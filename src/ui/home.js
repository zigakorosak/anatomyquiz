export function renderHome(root) {
  const el = document.createElement("main");
  el.className = "home";
  el.innerHTML = `
    <h1>Anatomy Quiz</h1>
    <p>Coming soon.</p>
  `;
  root.append(el);
}
