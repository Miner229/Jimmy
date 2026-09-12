export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function initialPieces(mode) {
  const players = mode === 'singles'
    ? [{id:'a1',x:50,y:24,team:'a',label:'Player A1'}, {id:'b1',x:50,y:76,team:'b',label:'Player B1'}]
    : [{id:'a1',x:30,y:22,team:'a',label:'Player A1'}, {id:'a2',x:70,y:22,team:'a',label:'Player A2'}, {id:'b1',x:30,y:78,team:'b',label:'Player B1'}, {id:'b2',x:70,y:78,team:'b',label:'Player B2'}];
  return [...players,{id:'shuttle',x:50,y:50,team:'shuttle',label:'Shuttlecock'}];
}
export function movePiece(pieces,id,x,y) {
  return pieces.map(p=>p.id===id?{...p,x:clamp(x,5,95),y:clamp(y,4,96)}:p);
}
