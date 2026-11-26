"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useAppBack } from "@/lib/back-navigation";

/** Keep the dialog inside the actual space between the current chat chrome. */
export function ChatStateDialog({container,onClose,children}:{container:HTMLElement;onClose:()=>void;children:ReactNode}) {
    const mask=useRef<HTMLDivElement>(null);
    useAppBack(onClose,()=>!!mask.current?.getClientRects().length,30);
    useLayoutEffect(()=>{
        const el=mask.current;
        if(!el)return;
        const header=container.querySelector<HTMLElement>(':scope > [data-ui="header"]');
        const footer=container.querySelector<HTMLElement>(':scope > [data-ui="input"], :scope > [data-ui="multi-select"]');
        const measure=()=>{
            const bounds=container.getBoundingClientRect();
            const scale=container.offsetHeight>0?bounds.height/container.offsetHeight:1;
            if(!scale)return;
            const viewport=window.visualViewport;
            const viewportTop=viewport?.offsetTop??0;
            const viewportBottom=viewportTop+(viewport?.height??window.innerHeight);
            const top=Math.max(bounds.top,header?.getBoundingClientRect().bottom??bounds.top,viewportTop);
            const bottom=Math.min(bounds.bottom,footer?.getBoundingClientRect().top??bounds.bottom,viewportBottom);
            el.style.top=Math.max(0,(top-bounds.top)/scale)+"px";
            el.style.height=Math.max(0,(bottom-top)/scale)+"px";
        };
        const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
        observer?.observe(container);
        if(header)observer?.observe(header);
        if(footer)observer?.observe(footer);
        measure();
        window.addEventListener("resize",measure);
        window.visualViewport?.addEventListener("resize",measure);
        window.visualViewport?.addEventListener("scroll",measure);
        return()=>{observer?.disconnect();window.removeEventListener("resize",measure);window.visualViewport?.removeEventListener("resize",measure);window.visualViewport?.removeEventListener("scroll",measure);};
    },[container]);
    return <div ref={mask} className="chat-state-dialog-mask" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section className="chat-state-dialog" role="dialog" aria-modal="true" aria-label="查看折叠状态">{children}</section></div>;
}
