import React from 'react';

export default function AutoScrollFeatures({children}) {
  return <div className="feature-autoscroll"><div className="feature-loop-window"><div className="feature-loop-track">{[0,1,2].map(copy=><div key={copy} className="feature-loop-group" aria-hidden={copy!==1?true:undefined}>{React.Children.map(children,child=>React.isValidElement(child)&&copy!==1?React.cloneElement(child,{tabIndex:-1}):child)}</div>)}</div></div></div>;
}
