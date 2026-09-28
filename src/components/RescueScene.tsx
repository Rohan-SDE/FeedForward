import { useEffect, useState } from "react";
import { Leaf, Pause, Play } from "lucide-react";
import "./rescue-scene.css";

/** CSS 3D geometry: no WebGL, network assets, or continuous JS render loop. */
export function RescueScene() {
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className={`rescue-scene ${paused ? "is-paused" : ""}`}>
      <div className="rescue-scene-heading">
        <span className="rescue-dot" /> THE NEXT MEAL STARTS HERE
      </div>
      <div
        className="rescue-stage"
        role="img"
        aria-label="Three-dimensional food rescue crate connecting a donor, a volunteer and an NGO"
      >
        <div className="rescue-orbit" aria-hidden="true">
          <div className="rescue-platform" />
          <div className="rescue-crate">
            <div className="crate-face crate-front">
              <Leaf size={32} />
              <strong>FeedForward</strong>
              <span>GOOD FOOD. SHARED.</span>
            </div>
            <div className="crate-face crate-back" />
            <div className="crate-face crate-left" />
            <div className="crate-face crate-right" />
            <div className="crate-face crate-top">
              <span className="produce produce-one" />
              <span className="produce produce-two" />
              <span className="produce produce-three" />
            </div>
          </div>
        </div>
        <span className="scene-label scene-donor">01 · Donate</span>
        <span className="scene-label scene-delivery">02 · Deliver</span>
        <span className="scene-label scene-ngo">03 · Nourish</span>
      </div>
      <div className="rescue-scene-footer">
        <p>
          Less waste.
          <br />
          <strong>More possibility.</strong>
        </p>
        <button
          type="button"
          disabled={!ready}
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Play illustration animation" : "Pause illustration animation"}
          aria-pressed={paused}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      </div>
    </div>
  );
}
