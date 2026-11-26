/** Shared viewport/shell positioning for Chat and mascot message menus. */
export type ContextMenuAnchor = {
    x: number;
    y: number;
    top: number;
    bottom: number;
};

export function bubbleContextAnchor(node: HTMLElement): ContextMenuAnchor {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top, bottom: rect.bottom };
    }

export function placeChatContextMenu(el: HTMLDivElement | null, anchor: ContextMenuAnchor | null, wrapper: HTMLElement | null) {
        if (!el || !anchor) return;
        const shell = wrapper?.getBoundingClientRect();
        const visual = window.visualViewport;
        const vp = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
            right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
            bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight) };
        const margin = 8, gap = 12;
        const bounds = { left: Math.max(vp.left, shell?.left ?? vp.left) + margin,
            top: Math.max(vp.top, shell?.top ?? vp.top) + margin,
            right: Math.min(vp.right, shell?.right ?? vp.right) - margin,
            bottom: Math.min(vp.bottom, shell?.bottom ?? vp.bottom) - margin };
        let containing: HTMLElement | null = el.parentElement;
        while (containing) {
            const style = window.getComputedStyle(containing);
            if (style.transform !== "none" || style.perspective !== "none" ||
                style.filter !== "none" || style.contain.includes("paint")) break;
            containing = containing.parentElement;
        }
        const origin = containing?.getBoundingClientRect();
        const sx = origin && containing?.offsetWidth ? origin.width / containing.offsetWidth || 1 : 1;
        const sy = origin && containing?.offsetHeight ? origin.height / containing.offsetHeight || 1 : 1;
        el.style.maxWidth = String(Math.max(60, bounds.right - bounds.left) / sx) + "px";
        el.style.whiteSpace = "normal";
        el.querySelectorAll<HTMLElement>(":scope > .flex").forEach(row => {
            row.style.flexWrap = "wrap";
            row.style.maxWidth = "100%";
        });
        const width = el.offsetWidth * sx, height = el.offsetHeight * sy;
        const left = Math.max(bounds.left, Math.min(anchor.x - width / 2, bounds.right - width));
        const below = anchor.top - height - gap < bounds.top && anchor.bottom + height + gap <= bounds.bottom;
        const top = Math.max(bounds.top, Math.min(below ? anchor.bottom + gap : anchor.top - height - gap, bounds.bottom - height));
        el.style.left = String((left - (origin?.left ?? 0)) / sx) + "px";
        el.style.top = String((top - (origin?.top ?? 0)) / sy) + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
        const triangle = el.querySelector<HTMLElement>("[data-menu-triangle]");
        if (triangle) {
            triangle.style.left = String(Math.max(14, Math.min((anchor.x - left) / sx, el.offsetWidth - 14))) + "px";
            triangle.style.right = "auto";
            triangle.style.transform = "translateX(-50%)";
            triangle.style.top = below ? "-6px" : "auto";
            triangle.style.bottom = below ? "auto" : "-6px";
            triangle.style.borderTop = below ? "none" : "6px solid var(--ctx-menu-bg, #2c2c2c)";
            triangle.style.borderBottom = below ? "6px solid var(--ctx-menu-bg, #2c2c2c)" : "none";
        }
    }
