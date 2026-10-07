import { expect, test } from "@playwright/test";

test("marketing header has one workspace link and fits supported viewport widths", async ({ page }) => {
  for (const width of [320, 375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const header = page.getByRole("banner");
    const workspaceLinks = header.getByRole("link", { name: "Open workspace", exact: true });
    await expect(workspaceLinks).toHaveCount(1);
    await expect(workspaceLinks).toHaveAttribute("href", "/dashboard");
    await expect(header.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#workflow");
    await expect(header.getByRole("link", { name: "Features" })).toHaveAttribute("href", "#features");

    const layout = await header.evaluate((element) => {
      const headerBox = element.getBoundingClientRect();
      const brandBox = element.querySelector('a[aria-label="DevSignal AI home"]')?.getBoundingClientRect();
      const nav = element.querySelector("nav");
      const navBox = nav?.getBoundingClientRect();
      const links = Array.from(nav?.querySelectorAll("a") ?? [], (link) => link.getBoundingClientRect());
      return {
        headerWidth: element.clientWidth,
        headerScrollWidth: element.scrollWidth,
        pageWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        brand: brandBox && { left: brandBox.left, right: brandBox.right, top: brandBox.top, bottom: brandBox.bottom },
        header: { left: headerBox.left, right: headerBox.right },
        nav: navBox && { left: navBox.left, right: navBox.right, top: navBox.top, bottom: navBox.bottom },
        links: links.map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })),
      };
    });

    expect(layout.headerScrollWidth, `header overflow at ${width}px`).toBeLessThanOrEqual(layout.headerWidth);
    expect(layout.pageScrollWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(layout.pageWidth);
    expect(layout.brand, `logo missing at ${width}px`).toBeTruthy();
    expect(layout.nav, `navigation missing at ${width}px`).toBeTruthy();
    expect(layout.links, `navigation links missing at ${width}px`).toHaveLength(3);
    for (const link of layout.links) {
      expect(link.left, `link left overflow at ${width}px`).toBeGreaterThanOrEqual(layout.header.left);
      expect(link.right, `link right overflow at ${width}px`).toBeLessThanOrEqual(layout.header.right);
      expect(link.bottom, `link clipped vertically at ${width}px`).toBeLessThanOrEqual(layout.nav?.bottom ?? 0);
    }
    expect(layout.brand?.left, `logo left overflow at ${width}px`).toBeGreaterThanOrEqual(layout.header.left);
    expect(layout.brand?.right, `logo right overflow at ${width}px`).toBeLessThanOrEqual(layout.header.right);
    if (width < 768) {
      expect(layout.brand?.bottom, `logo overlaps navigation at ${width}px`).toBeLessThanOrEqual(layout.nav?.top ?? 0);
    } else {
      expect(layout.brand?.right, `logo overlaps navigation at ${width}px`).toBeLessThanOrEqual(layout.nav?.left ?? 0);
    }
  }
});
