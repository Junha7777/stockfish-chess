import React, { useCallback, useMemo, useRef, useState } from "react";
import { Chess, Square, Move } from "chess.js";

const files = ["a","b","c","d","e","f","g","h"] as const;
const ranks = ["8","7","6","5","4","3","2","1"] as const;

function squareColor(fileIdx: number, rankIdx: number) {
  return (fileIdx + rankIdx) % 2 === 0 ? "bg-amber-200" : "bg-emerald-700";
}

function parseBestMove(best: string | null): string | null {
  if (!best) return null;
  const parts = best.trim().split(/\s+/);
  const idx = parts.findIndex(p => p.toLowerCase() === "bestmove");
  const uci = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts[0];
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ? uci : null;
}

async function fetchBestMove(fen: string, depth: number) {
  const d = Math.min(depth, 15);
  const url = new URL("https://stockfish.online/api/s/v2.php");
  url.searchParams.set("fen", fen);
  url.searchParams.set("depth", String(d));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Engine HTTP ${res.status}`);
  const json = await res.json();
  return {
    eval: typeof json.evaluation === "number" ? json.evaluation : null,
    mate: json.mate as number | null,
    bestUci: parseBestMove(typeof json.bestmove === "string" ? json.bestmove : null),
  };
}

export default function StockfishChess() {
  const [game, setGame] = useState(() => new Chess());
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [history, setHistory] = useState<Move[]>([]);
  const [engineDepth, setEngineDepth] = useState(12);
  const [evalInfo, setEvalInfo] = useState<{cp: number | null; mate: number | null}>({ cp: null, mate: null });
  const [busy, setBusy] = useState(false);
  const [flip, setFlip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promotionSquare, setPromotionSquare] = useState<Square | null>(null);
  const [engineEnabled, setEngineEnabled] = useState(true);
  const lastMoveRef = useRef<Move | null>(null);

  const fen = useMemo(() => game.fen(), [game]);

  const squares = useMemo(() => {
    const f = [...files];
    const r = [...ranks];
    return flip ? { f: f.slice().reverse(), r: r.slice().reverse() } : { f, r };
  }, [flip]);

  const turn = game.turn() === "w" ? "White" : "Black";
  const inCheck = game.inCheck();
  const isGameOver = game.isGameOver();

  const handlePromotion = useCallback((piece: 'q'|'r'|'b'|'n') => {
    if (!promotionSquare || !selected) return;
    const move = game.move({ from: selected, to: promotionSquare, promotion: piece });
    if (move) {
      lastMoveRef.current = move as Move;
      setPromotionSquare(null);
      setSelected(null);
      setLegalTargets([]);
      setGame(new Chess(game.fen()));
      setHistory(prev => [...prev, move as Move]);
      if (engineEnabled) void engineMove(game.fen());
    }
  }, [game, selected, promotionSquare, engineEnabled]);

  const onSquareClick = useCallback((sq: Square) => {
    if (busy || isGameOver) return;
    const piece = game.get(sq);

    if (promotionSquare) return;

    if (piece && ((game.turn() === "w" && piece.color === "w") || (game.turn() === "b" && piece.color === "b"))) {
      setSelected(sq);
      const moves = game.moves({ square: sq, verbose: true }) as Move[];
      setLegalTargets(moves.map(m => m.to));
      return;
    }

    if (!selected) return;

    const possible = game.moves({ square: selected, verbose: true }) as Move[];
    const targetMove = possible.find(m => m.to === sq);

    if (targetMove && targetMove.promotion) {
      setPromotionSquare(sq);
      return;
    }

    const move = game.move({ from: selected, to: sq, promotion: "q" });
    if (move) {
      lastMoveRef.current = move as Move;
      setSelected(null);
      setLegalTargets([]);
      setGame(new Chess(game.fen()));
      setHistory(prev => [...prev, move as Move]);
      if (engineEnabled) void engineMove(game.fen());
    }
  }, [game, selected, busy, isGameOver, promotionSquare, engineEnabled]);

  const engineMove = useCallback(async (fenNow?: string) => {
    if (!engineEnabled) return;
    const curFen = fenNow ?? game.fen();
    if (game.isGameOver()) return;
    setBusy(true); setError(null);
    try {
      const { bestUci, eval: cp, mate } = await fetchBestMove(curFen, engineDepth);
      setEvalInfo({ cp: cp, mate: mate });
      if (bestUci) {
        const from = bestUci.slice(0, 2) as Square;
        const to = bestUci.slice(2, 4) as Square;
        const promo = bestUci.length === 5 ? bestUci[4] : undefined;
        const move = game.move({ from, to, promotion: promo as any });
        if (move) {
          lastMoveRef.current = move as Move;
          setGame(new Chess(game.fen()));
          setHistory(prev => [...prev, move as Move]);
        }
      } else {
        setError("엔진이 유효한 수를 주지 않았음");
      }
    } catch (e: any) {
      setError(e?.message ?? "엔진 호출 오류");
    } finally {
      setBusy(false);
    }
  }, [game, engineDepth, engineEnabled]);

  const newGame = useCallback((playAs: "w" | "b" = "w") => {
    const g = new Chess();
    setGame(g);
    setHistory([]);
    setSelected(null);
    setLegalTargets([]);
    setEvalInfo({ cp: null, mate: null });
    setError(null);
    setFlip(playAs === "b");
    if (playAs === "b" && engineEnabled) {
      setTimeout(() => { void engineMove(g.fen()); }, 0);
    }
  }, [engineMove, engineEnabled]);

  const lastFromTo = useMemo(() => {
    const m = lastMoveRef.current;
    return m ? { from: m.from as string, to: m.to as string } : null;
  }, [history]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center gap-6 p-6 bg-zinc-950 text-zinc-100 relative">
      {promotionSquare && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-50">
          <div className="bg-zinc-800 p-4 rounded-xl text-center">
            <h2 className="mb-3">Promote to:</h2>
            <div className="flex gap-2 justify-center">
              {(['q','r','b','n'] as const).map(p => (
                <button key={p} onClick={() => handlePromotion(p)} className="text-3xl px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg">
                  {glyph(p, game.turn())}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <header className="w-full max-w-5xl flex justify-between">
        <h1 className="text-2xl font-bold">Stockfish 1v1 Chess</h1>
        <span className="px-2 py-1 rounded bg-zinc-800">Turn: {turn}{inCheck ? " (check)" : ""}</span>
      </header>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-wrap gap-2 bg-zinc-900 p-3 rounded-2xl">
          <button onClick={() => newGame("w")} className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700">New (White)</button>
          <button onClick={() => newGame("b")} className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700">New (Black)</button>
          <button onClick={() => setEngineEnabled(v => !v)} className={`px-3 py-2 rounded-xl ${engineEnabled ? 'bg-green-700 hover:bg-green-600' : 'bg-zinc-700 hover:bg-zinc-600'}`}>{engineEnabled ? 'AI ON' : 'AI OFF'}</button>
          <button onClick={() => setFlip(v => !v)} className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700">Flip</button>
        </div>

        <div className="flex items-center gap-3 bg-zinc-900 p-3 rounded-2xl">
          <label className="text-sm w-24">Depth: {engineDepth}</label>
          <input type="range" min={6} max={15} value={engineDepth} onChange={e => setEngineDepth(parseInt(e.target.value))} className="w-full"/>
          <button disabled={!engineEnabled || busy || isGameOver} onClick={() => engineMove()} className="px-3 py-2 rounded-xl bg-indigo-700/80 hover:bg-indigo-600 disabled:opacity-40">Engine Move</button>
        </div>

        <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-2xl">
          <div className="text-sm">
            <div>Eval: {evalInfo.mate !== null ? `#${evalInfo.mate}` : (evalInfo.cp !== null ? (evalInfo.cp >= 0 ? "+" : "") + evalInfo.cp.toFixed(2) : "—")}</div>
          </div>
          {busy && <div className="animate-pulse text-xs">Thinking…</div>}
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      </div>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-2">
          <div className="aspect-square w-full max-w-[640px] mx-auto select-none rounded-2xl overflow-hidden shadow-2xl border border-zinc-800">
            {squares.r.map((r, rIdx) => (
              <div key={r} className="grid grid-cols-8 w-full h-[12.5%]">
                {squares.f.map((f, fIdx) => {
                  const sq = `${f}${r}` as Square;
                  const piece = game.get(sq);
                  const isSelected = selected === sq;
                  const isLegal = legalTargets.includes(sq);
                  const isLast = lastFromTo && (lastFromTo.from === sq || lastFromTo.to === sq);
                  const isCheckKing = inCheck && piece?.type === "k" && ((game.turn() === "w" && piece.color === "w") || (game.turn() === "b" && piece.color === "b"));

                  return (
                    <button key={sq} onClick={() => onSquareClick(sq)}
                      className={["relative w-full h-full flex items-center justify-center text-3xl md:text-5xl font-semibold",
                        squareColor(fIdx, rIdx), isSelected ? "outline outline-4 outline-yellow-400" : "", isLegal ? "after:content-[''] after:absolute after:w-4 after:h-4 md:after:w-5 md:after:h-5 after:rounded-full after:bg-black/40" : "", isLast ? "ring-4 ring-indigo-500/60" : "", isCheckKing ? "!bg-red-700" : ""].join(" ")}
                    >
                      {piece && (
                        <span className={piece.color === "w" ? "text-zinc-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" : "text-zinc-900"}>{glyph(piece.type, piece.color)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-1">
          <div className="bg-zinc-900 rounded-2xl p-4 h-full max-h-[640px] overflow-y-auto">
            <h2 className="font-semibold mb-2">Moves</h2>
            <ol className="grid grid-cols-2 gap-x-3 text-sm">
              {chunk(history, 2).map((pair, idx) => (
                <li key={idx} className="contents">
                  <span className="opacity-60">{idx + 1}.</span>
                  <div className="grid grid-cols-2 gap-x-2">
                    <span>{pair[0] ? pair[0].san : ""}</span>
                    <span>{pair[1] ? pair[1].san : ""}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function glyph(type: string, color: "w" | "b") {
  const G: Record<string, string> = {
    P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
    p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
  };
  return G[color === "w" ? type.toUpperCase() : type.toLowerCase()];
}
