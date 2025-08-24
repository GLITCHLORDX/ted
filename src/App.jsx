import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Rect, Circle, Text as KonvaText } from "react-konva";
import { v4 as uuid } from "uuid";
import Dexie from "dexie";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";

// Dexie DB
const db = new Dexie("pixelnote_palace_fixed");
db.version(1).stores({
  notebooks: "id, title, updatedAt",
  pages: "id, notebookId, idx",
  pageStates: "pageId"
});

const Tools = {
  PEN: "pen",
  HIGHLIGHTER: "highlighter",
  ERASER: "eraser",
  RECT: "rect",
  ELLIPSE: "ellipse",
  LINE: "line",
  ARROW: "arrow",
  TEXT: "text"
};

function App() {
  const [notebooks, setNotebooks] = useState([]);
  const [pages, setPages] = useState([]);
  const [activeNotebookId, setActiveNotebookId] = useState(null);
  const [activePageId, setActivePageId] = useState(null);
  const [objects, setObjects] = useState([]);
  const [bgImageUrl, setBgImageUrl] = useState(null);

  const [tool, setTool] = useState(Tools.PEN);
  const [color, setColor] = useState("#111827");
  const [width, setWidth] = useState(3);
  const [highOpacity, setHighOpacity] = useState(0.25);

  const stageRef = useRef(null);
  const isDrawingRef = useRef(false);
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  useEffect(() => {
    (async () => {
      let nb = await db.notebooks.toArray();
      if (nb.length === 0) {
        const id = uuid();
        const now = Date.now();
        await db.notebooks.add({ id, title: "My Notebook", updatedAt: now });
        const pid = uuid();
        await db.pages.add({ id: pid, notebookId: id, idx: 0 });
        await db.pageStates.put({ pageId: pid, data: JSON.stringify({ objects: [], bgImageUrl: null }) });
        nb = await db.notebooks.toArray();
      }
      setNotebooks(nb);
      const cur = nb[0];
      setActiveNotebookId(cur.id);
      const ps = await db.pages.where({ notebookId: cur.id }).sortBy("idx");
      setPages(ps);
      setActivePageId(ps[0].id);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!activePageId) return;
      const s = await db.pageStates.get(activePageId);
      if (s?.data) {
        const parsed = JSON.parse(s.data);
        setObjects(parsed.objects || []);
        setBgImageUrl(parsed.bgImageUrl || null);
        undoStack.current = [JSON.stringify(parsed)];
        redoStack.current = [];
      } else {
        setObjects([]);
        setBgImageUrl(null);
      }
    })();
  }, [activePageId]);

  useEffect(() => {
    const tid = setTimeout(async () => {
      if (!activePageId) return;
      await db.pageStates.put({ pageId: activePageId, data: JSON.stringify({ objects, bgImageUrl }) });
      await db.notebooks.update(activeNotebookId, { updatedAt: Date.now() });
    }, 350);
    return () => clearTimeout(tid);
  }, [objects, bgImageUrl, activePageId, activeNotebookId]);

  const pushHistory = (state) => {
    undoStack.current.push(JSON.stringify(state));
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };

  useEffect(() => {
    // capture initial state after load
  }, []);

  const addNotebook = async () => {
    const id = uuid();
    await db.notebooks.add({ id, title: "Notebook " + (notebooks.length + 1), updatedAt: Date.now() });
    const pid = uuid();
    await db.pages.add({ id: pid, notebookId: id, idx: 0 });
    await db.pageStates.put({ pageId: pid, data: JSON.stringify({ objects: [], bgImageUrl: null }) });
    const nb = await db.notebooks.toArray();
    setNotebooks(nb);
    setActiveNotebookId(id);
    const ps = await db.pages.where({ notebookId: id }).sortBy("idx");
    setPages(ps);
    setActivePageId(ps[0].id);
  };

  const addPage = async () => {
    if (!activeNotebookId) return;
    const idx = pages.length;
    const pid = uuid();
    await db.pages.add({ id: pid, notebookId: activeNotebookId, idx });
    await db.pageStates.put({ pageId: pid, data: JSON.stringify({ objects: [], bgImageUrl: null }) });
    const ps = await db.pages.where({ notebookId: activeNotebookId }).sortBy("idx");
    setPages(ps);
    setActivePageId(pid);
  };

  const onMouseDown = (e) => {
    if (![Tools.PEN, Tools.HIGHLIGHTER, Tools.ERASER, Tools.LINE, Tools.RECT, Tools.ELLIPSE, Tools.ARROW].includes(tool)) return;
    isDrawingRef.current = true;
    const pos = stageRef.current.getPointerPosition();
    if ([Tools.PEN, Tools.HIGHLIGHTER, Tools.ERASER].includes(tool)) {
      const id = uuid();
      const obj = {
        id, type: "line", tool,
        points: [pos.x, pos.y],
        color: color,
        width: tool === Tools.HIGHLIGHTER ? Math.max(12, width*2) : width,
        opacity: tool === Tools.HIGHLIGHTER ? highOpacity : 1,
        erasing: tool === Tools.ERASER
      };
      setObjects(prev => { const n = [...prev, obj]; pushHistory({ objects: n, bgImageUrl }); return n; });
    } else {
      const id = uuid();
      const obj = { id, type: tool.toLowerCase(), x: pos.x, y: pos.y, w: 0, h: 0, color, width };
      setObjects(prev => { const n = [...prev, obj]; pushHistory({ objects: n, bgImageUrl }); return n; });
    }
  };

  const onMouseMove = (e) => {
    if (!isDrawingRef.current) return;
    const pos = stageRef.current.getPointerPosition();
    setObjects(prev => {
      const next = prev.slice();
      const cur = next[next.length - 1];
      if (!cur) return next;
      if (cur.type === "line") {
        cur.points = cur.points.concat([pos.x, pos.y]);
      } else {
        cur.w = pos.x - cur.x;
        cur.h = pos.y - cur.y;
      }
      return next;
    });
  };

  const onMouseUp = () => { isDrawingRef.current = false; };

  const onDoubleClick = (e) => {
    if (tool !== Tools.TEXT) return;
    const pos = stageRef.current.getPointerPosition();
    const id = uuid();
    const t = { id, type: "text", text: "Edit me", x: pos.x, y: pos.y, fontSize: 20, color };
    setObjects(prev => { const n = [...prev, t]; pushHistory({ objects: n, bgImageUrl }); return n; });
  };

  const importPdf = async (file) => {
    try {
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const url = canvas.toDataURL("image/png");
      setBgImageUrl(url);
      pushHistory({ objects, bgImageUrl: url });
    } catch (err) {
      alert("PDF import failed: " + err.message);
    }
  };

  const exportPNG = () => {
    if (!stageRef.current) return;
    const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = uri;
    a.download = "page.png";
    a.click();
  };

  const undo = () => {
    if (undoStack.current.length <= 1) return;
    const curr = undoStack.current.pop();
    redoStack.current.push(curr);
    const prev = JSON.parse(undoStack.current[undoStack.current.length - 1]);
    setObjects(prev.objects || []);
    setBgImageUrl(prev.bgImageUrl || null);
  };

  const redo = () => {
    if (redoStack.current.length === 0) return;
    const next = JSON.parse(redoStack.current.pop());
    undoStack.current.push(JSON.stringify(next));
    setObjects(next.objects || []);
    setBgImageUrl(next.bgImageUrl || null);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <strong>Notebooks</strong>
          <button className="button" onClick={addNotebook}>New</button>
        </div>
        <div className="leftList">
          {notebooks.map(nb => (
            <div key={nb.id} style={{marginBottom:8}}>
              <div style={{fontSize:14,fontWeight:600}}>{nb.title}</div>
              <div className="small">{new Date(nb.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <div style={{fontWeight:600}}>Pages</div>
            <button className="button" onClick={addPage}>Add</button>
          </div>
          <div>
            {pages.map((p, idx) => (
              <div key={p.id} className={"pageItem " + (p.id===activePageId ? "active" : "")} onClick={() => setActivePageId(p.id)}>
                <div style={{fontSize:13}}>Page {idx+1}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="row">
            <button className="button" onClick={() => setTool(Tools.PEN)} style={{background: tool===Tools.PEN ? '#eef2ff' : 'white'}}>Pen</button>
            <button className="button" onClick={() => setTool(Tools.HIGHLIGHTER)} style={{background: tool===Tools.HIGHLIGHTER ? '#eef2ff' : 'white'}}>Highlighter</button>
            <button className="button" onClick={() => setTool(Tools.ERASER)} style={{background: tool===Tools.ERASER ? '#eef2ff' : 'white'}}>Eraser</button>
            <button className="button" onClick={() => setTool(Tools.LINE)} style={{background: tool===Tools.LINE ? '#eef2ff' : 'white'}}>Line</button>
            <button className="button" onClick={() => setTool(Tools.RECT)} style={{background: tool===Tools.RECT ? '#eef2ff' : 'white'}}>Rect</button>
            <button className="button" onClick={() => setTool(Tools.ELLIPSE)} style={{background: tool===Tools.ELLIPSE ? '#eef2ff' : 'white'}}>Ellipse</button>
            <button className="button" onClick={() => setTool(Tools.TEXT)} style={{background: tool===Tools.TEXT ? '#eef2ff' : 'white'}}>Text</button>
          </div>

          <div style={{flex:1}} />

          <div className="row">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <input type="range" min="1" max="40" value={width} onChange={(e) => setWidth(parseInt(e.target.value))} />
            <input type="range" min="0.05" max="1" step="0.05" value={highOpacity} onChange={(e) => setHighOpacity(parseFloat(e.target.value))} />
            <button className="button" onClick={undo}>Undo</button>
            <button className="button" onClick={redo}>Redo</button>

            <label className="button" style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              Import PDF
              <input type="file" accept="application/pdf" style={{display:'none'}} onChange={(e) => e.target.files && importPdf(e.target.files[0])} />
            </label>

            <button className="button" onClick={exportPNG}>Export PNG</button>
          </div>
        </div>

        <div className="canvasWrap">
          <div className="stageBox" onDoubleClick={onDoubleClick}>
            <Stage
              ref={stageRef}
              width={900}
              height={1200}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            >
              <Layer>
                {bgImageUrl && (
                  // small optimization: draw as rect fill using DOM-backed image created on the fly
                  <Rect x={0} y={0} width={900} height={1200} fillPatternImage={(function(){
                    const img=new window.Image(); img.src=bgImageUrl; return img;
                  })()} />
                )}

                {objects.map(obj => {
                  if (obj.type === "line") {
                    return <Line key={obj.id} points={obj.points} stroke={obj.color} strokeWidth={obj.width} opacity={obj.opacity||1} lineCap="round" lineJoin="round" tension={0.4} globalCompositeOperation={obj.erasing ? "destination-out":"source-over"} />;
                  }
                  if (obj.type === "rect") {
                    return <Rect key={obj.id} x={obj.x} y={obj.y} width={obj.w} height={obj.h} stroke={obj.color} strokeWidth={obj.width} />;
                  }
                  if (obj.type === "ellipse") {
                    const rx = Math.abs(obj.w)/2 || 1;
                    const ry = Math.abs(obj.h)/2 || 1;
                    return <Circle key={obj.id} x={obj.x + obj.w/2} y={obj.y + obj.h/2} radius={Math.max(rx,ry)} stroke={obj.color} strokeWidth={obj.width} />;
                  }
                  if (obj.type === "text") {
                    return <KonvaText key={obj.id} text={obj.text} x={obj.x} y={obj.y} fontSize={obj.fontSize||18} fill={obj.color} />;
                  }
                  return null;
                })}
              </Layer>
            </Stage>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;