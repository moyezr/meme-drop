"use client";

import Image from "next/image";
import { useState } from "react";
import { landingExamples } from "./landing-examples";

export function HumorDemo() {
  const [selected, setSelected] = useState(0);
  const [replay, setReplay] = useState(0);
  const example = landingExamples[selected];

  return (
    <div className="humorDemo">
      <div className="humorPreview" key={`${example.id}-${replay}`}>
        <div className="contextCard">
          <span className="cardLabel">01 / YOUR AGENT SENDS CONTEXT</span>
          <p>“{example.context}”</p>
          <span className="contextSource"><span aria-hidden="true">&gt;_</span>{example.source}</span>
        </div>
        <div className="humorConnector" aria-hidden="true"><span /><b>m.</b><span /></div>
        <div className="memeResult" aria-live="polite" aria-atomic="true">
          <span className="cardLabel">02 / MEMEDROP FINDS THE PUNCHLINE</span>
          <figure className="exampleMeme">
            <figcaption>{example.caption}</figcaption>
            <Image src={example.image} alt={example.alt} width={example.width} height={example.height} sizes="(max-width: 720px) 90vw, 380px" priority={selected === 0} />
          </figure>
        </div>
      </div>
      <div className="exampleControls" role="group" aria-label="Choose an illustrative meme example">
        {landingExamples.map((item, index) => (
          <button key={item.id} type="button" aria-pressed={selected === index} onClick={() => { setSelected(index); setReplay((value) => value + 1); }}>
            {item.label}
          </button>
        ))}
        <button className="replayButton" type="button" aria-label="Replay the example animation" onClick={() => setReplay((value) => value + 1)}>Replay <span aria-hidden="true">↻</span></button>
      </div>
      <p className="exampleNote">Curated examples, not a live API call. Your context shapes the result.</p>
    </div>
  );
}
