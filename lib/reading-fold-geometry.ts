/** Straight crease: the perpendicular bisector of the anchored corner and dragged point.
 * This is the exact half-plane / reflection geometry used in the 089 preview.
 */
export type FoldPoint={x:number;y:number};
export type FoldGeometry={front:FoldPoint[];revealed:FoldPoint[];flap:FoldPoint[];normal:FoldPoint;mid:FoldPoint;depth:number;crease:FoldPoint[];progress:number};
export const foldClamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const dot=(p:FoldPoint,n:FoldPoint)=>p.x*n.x+p.y*n.y;
function clip(poly:FoldPoint[],n:FoldPoint,s:number,front:boolean){
 const out:FoldPoint[]=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=dot(a,n)-s,db=dot(b,n)-s;
  const ai=front?da<=.0001:da>=-.0001,bi=front?db<=.0001:db>=-.0001;
  if(ai)out.push(a);
  if(ai!==bi){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
 }
 return out;
}
export function readingFoldGeometry(w:number,h:number,c:FoldPoint,p:FoldPoint):FoldGeometry|null{
 const dx=c.x-p.x,dy=c.y-p.y,len=Math.hypot(dx,dy);
 if(w<=0||h<=0||len<.7)return null;
 const normal={x:dx/len,y:dy/len},mid={x:(c.x+p.x)/2,y:(c.y+p.y)/2},s=dot(mid,normal);
 const rect=[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
 const front=clip(rect,normal,s,true),revealed=clip(rect,normal,s,false);
 const flap=revealed.map(q=>{const d=dot(q,normal)-s;return{x:q.x-2*d*normal.x,y:q.y-2*d*normal.y};});
 const crease=front.filter((q,i)=>Math.abs(dot(q,normal)-s)<.02&&front.findIndex(r=>Math.hypot(q.x-r.x,q.y-r.y)<.03)===i);
 return {front,revealed,flap,normal,mid,depth:Math.max(1,...revealed.map(q=>dot(q,normal)-s)),crease,progress:foldClamp(Math.abs(dx)/(2*w),0,1)};
}
export function foldClipPath(poly:FoldPoint[],w:number,h:number){
 return poly.length<3?"polygon(0 0,0 0,0 0)":"polygon("+poly.map(p=>(p.x/w*100).toFixed(4)+"% "+(p.y/h*100).toFixed(4)+"%").join(",")+")";
}
export function shouldCompleteReadingFold(distance:number,width:number,speed:number,cancelled=false){
 return !cancelled&&(distance>width*.34||distance>24&&speed>.45);
}
