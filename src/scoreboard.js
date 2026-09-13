export const cleanTeamName = value => value.replace(/[^a-z]/gi,'').slice(0,6);
export const changeScore = (score,delta) => Math.max(0,Math.min(99,score+delta));
