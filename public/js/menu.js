document.addEventListener("DOMContentLoaded", () => {
	const menuBtn = document.getElementById("menu-toggle-btn");
	const sidebar = document.getElementById("sidebar-container");
	const sidebarMenu = document.getElementById("sidebar-menu");
	const content = document.getElementById("content-wrapper");
	const body = document.body;
	if (!menuBtn || !content || !body) return;

	const toggleMenu = () => {
		if (sidebar) sidebar.classList.toggle("active");
		body.classList.toggle("menu-open");
		body.classList.toggle("sidebar-open");
	};

	menuBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		toggleMenu();
	});

	content.addEventListener("click", (e) => {
		if (!body.classList.contains("menu-open") && !body.classList.contains("sidebar-open")) return;
		if (sidebarMenu && e.target.closest("#sidebar-menu")) return;
		if (window.innerWidth < 992 || body.classList.contains("sidebar-open")) {
			if (sidebar) sidebar.classList.remove("active");
			body.classList.remove("menu-open");
			body.classList.remove("sidebar-open");
		}
	});
});
