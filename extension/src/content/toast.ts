const TOAST_DURATION = 3000;

export function showToast(message: string, type: "success" | "error" = "success") {
  // Remove any existing toast
  const existing = document.getElementById("memedrop-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "memedrop-toast";
  toast.textContent = message;

  const bgColor = type === "success" ? "rgba(0, 186, 124, 0.95)" : "rgba(244, 33, 46, 0.95)";

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    padding: "12px 20px",
    borderRadius: "8px",
    background: bgColor,
    color: "white",
    fontSize: "14px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontWeight: "500",
    zIndex: "10000",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    transition: "opacity 0.3s, transform 0.3s",
    opacity: "0",
    transform: "translateY(10px)",
    maxWidth: "360px",
    wordBreak: "break-word",
  });

  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, TOAST_DURATION);
}
