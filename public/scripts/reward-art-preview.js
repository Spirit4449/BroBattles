const dialog = document.getElementById("detail");
const heading = document.getElementById("detail-title");
const large = document.getElementById("detail-art");

function add(group, title, path) {
  const button = document.createElement("button");
  button.className = "art";
  const img = document.createElement("img");
  img.src = path;
  img.alt = title;
  const text = document.createElement("span");
  text.textContent = title;
  button.append(img, text);
  button.addEventListener("click", () => {
    heading.textContent = title;
    large.src = path;
    large.alt = title;
    dialog.showModal();
  });
  document.getElementById(group).append(button);
}

for (const type of ["coins", "gems"]) {
  const samples = [
    ["small", type === "coins" ? "Small stack" : "Small cluster"],
    ["stack", "Treasure pile"],
    ["bag", "Overflowing bag"],
    ["chest", "Treasure chest"],
    ["chests", "Two chests"],
    ["cart", "Treasure cart"],
  ];
  for (const [level, label] of samples) add(type, label, `/assets/currency/${type}-${level}.webp`);
}

const milestones = [
  [100, "Capture the Flag"],
  [250, "Bank Bust"],
  [500, "500 trophies"],
  [750, "Airdrop"],
  [1000, "1,000 trophies"],
  [1500, "Bro Ball"],
  [2500, "Bedwars"],
  [5000, "5,000 trophies"],
  [7500, "7,500 trophies"],
  [10000, "Arena Legend"],
];
for (const [id, title] of milestones) {
  add("bundles", title, `/assets/reward-bundles/milestone-${id}.webp`);
}

document.getElementById("close").addEventListener("click", () => dialog.close());
