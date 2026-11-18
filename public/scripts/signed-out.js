fetch("/logout", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin",
}).catch(error => console.error("Error:", error));
