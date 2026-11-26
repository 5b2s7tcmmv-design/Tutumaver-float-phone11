import type { DesktopIconLayout, DesktopPageKey } from "./desktop-layout-storage";
import type { IconPosition } from "./desktop-config";
import { WIDGET_SIZE_CELLS, type WidgetInstance, type DesktopGridConfig } from "./widget-types";

// Reserve in-bounds positions before moving overflow, preserving component ids and configs.
export function reflowDesktopGrid(layout: DesktopIconLayout, widgets: WidgetInstance[], grid: DesktopGridConfig) {
  const occupied = new Set<string>();
  const result = { page1: [], page2: [] } as DesktopIconLayout;
  const nextWidgets: WidgetInstance[] = [];
  const key = (p: number, r: number, c: number) => p + ":" + r + ":" + c;
  const fits = (p: number, r: number, c: number, h: number, w: number) => {
    if (![p,r,c,h,w].every(Number.isInteger) || p < 1 || r < 1 || c < 1 || r+h-1 > grid.rows || c+w-1 > grid.cols) return false;
    for(let y=r;y<r+h;y++) for(let x=c;x<c+w;x++) if(occupied.has(key(p,y,x))) return false;
    return true;
  };
  const reserve = (p: number,r: number,c: number,h: number,w: number) => {
    for(let y=r;y<r+h;y++) for(let x=c;x<c+w;x++) occupied.add(key(p,y,x));
  };
  const find = (p: number,h: number,w: number) => {
    if(h>grid.rows || w>grid.cols) throw Error("当前网格无法容纳已有小组件，请先调整组件大小。");
    for(let page=Number.isSafeInteger(p)&&p>0?p:1;;page++) for(let row=1;row<=grid.rows-h+1;row++) for(let col=1;col<=grid.cols-w+1;col++) {
      if(fits(page,row,col,h,w)) return {page,row,col};
    }
  };
  const pendingWidgets: WidgetInstance[] = [];
  const seenWidgets = new Set<string>();
  for (const widget of widgets) {
    if(seenWidgets.has(widget.id)) continue;
    seenWidgets.add(widget.id);
    const size=WIDGET_SIZE_CELLS[widget.size];
    if(!size) throw Error("存在不支持的小组件尺寸，未更改桌面。");
    const [h,w]=size;
    if(fits(widget.page,widget.row,widget.col,h,w)) {
      reserve(widget.page,widget.row,widget.col,h,w); nextWidgets.push(widget);
    } else pendingWidgets.push(widget);
  }
  const pendingIcons: {page:number;icon:IconPosition}[]=[];
  const seenIcons=new Set<string>();
  const put=(page:number,icon:IconPosition)=> {
    const pageKey=("page"+page) as DesktopPageKey;
    (result[pageKey]??=[]).push(icon);
    reserve(page,icon.row,icon.col,1,1);
  };
  const pages=Object.keys(layout).filter(k=>/^page[1-9]\d*$/.test(k)).sort((a,b)=>Number(a.slice(4))-Number(b.slice(4)));
  for(const pageKey of pages) {
    const page=Number(pageKey.slice(4));
    if(!Number.isSafeInteger(page)) continue;
    for(const icon of layout[pageKey as DesktopPageKey]??[]) {
      if(seenIcons.has(icon.id)) continue;
      seenIcons.add(icon.id);
      if(fits(page,icon.row,icon.col,1,1)) put(page,icon);
      else pendingIcons.push({page,icon});
    }
  }
  for(const widget of pendingWidgets) {
    const [h,w]=WIDGET_SIZE_CELLS[widget.size];
    const pos=find(widget.page,h,w); reserve(pos.page,pos.row,pos.col,h,w);
    nextWidgets.push({...widget,...pos});
  }
  for(const {page,icon} of pendingIcons) {
    const pos=find(page,1,1); put(pos.page,{...icon,row:pos.row,col:pos.col});
  }
  return {layout:result,widgets:nextWidgets};
}
