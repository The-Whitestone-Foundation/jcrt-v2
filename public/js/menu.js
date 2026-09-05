// Sidebar toggle. State lives in sessionStorage ("jcrt:sidebar" = "open" | "closed") so an
// open sidebar survives navigation for the life of the tab. The inline script at the top
// of <body> in base.njk restores it before first paint, but only above 1195px, where the
// sidebar pushes content instead of covering it. No transitions anywhere: index.css has
// none on the sidebar, shell or toggle, so open/close and restore are instant.
document.addEventListener("DOMContentLoaded", () => {
	const menuBtn = document.getElementById("menu-toggle-btn");
	const sidebar = document.getElementById("sidebar-container");
	const sidebarMenu = document.getElementById("sidebar-menu");
	const content = document.getElementById("content-wrapper");
	const body = document.body;
	if (!menuBtn || !content || !body) return;

	const desktop = window.matchMedia("(min-width: 1196px)");

	const setOpen = (open) => {
		body.classList.toggle("menu-open", open);
		body.classList.toggle("sidebar-open", open);
		if (sidebar) sidebar.classList.toggle("active", open);
		try {
			sessionStorage.setItem("jcrt:sidebar", open ? "open" : "closed");
		} catch (_) {
			/* storage unavailable (private mode, blocked): the sidebar still works, it just isn't remembered */
		}
	};

	const isOpen = () => body.classList.contains("menu-open");

	// The restore script only sets the body classes; bring the container in line.
	if (sidebar) sidebar.classList.toggle("active", isOpen());

	menuBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		setOpen(!isOpen());
	});

	// A click in the content closes the sidebar (on phones always; on desktop as before).
	// This also clears the remembered state, so the next page loads closed.
	content.addEventListener("click", (e) => {
		if (!isOpen()) return;
		if (sidebarMenu && e.target.closest("#sidebar-menu")) return;
		if (window.innerWidth < 992 || body.classList.contains("sidebar-open")) setOpen(false);
	});

	// Shrinking below the desktop breakpoint (rotate, split view) turns the sidebar into an
	// overlay; don't leave it covering the content.
	desktop.addEventListener("change", (e) => {
		if (!e.matches && isOpen()) setOpen(false);
	});
});
