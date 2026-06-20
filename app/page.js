'use client';

import { useState, useEffect } from 'react';
import './globals.css';
import { loadKey, saveKey, clearKey, touchKey, getKeyInfo, INACTIVITY_DAYS } from '../lib/keyStore.js';
import { keywordMatch } from '../lib/sdgs.js';
import { classifyWithGemini } from '../lib/geminiClient.js';
import { classifySemantic } from '../lib/localSemantic.js';

const ENGINES = {
  auto: { label: '⚡ 自動', needKey: false },
  gemini: { label: '☁️ Gemini', needKey: true },
  semantic: { label: '🧠 語意(免金鑰)', needKey: false },
};

export default function Home() {
  const [mode, setMode] = useState('text'); // 'text' | 'url'
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  // 引擎選擇:auto / gemini / semantic(預設自動)
  const [engine, setEngine] = useState('auto');
  const [showEngines, setShowEngines] = useState(false); // 進階:是否展開手動切換
  const [progress, setProgress] = useState(null); // { percent, text }

  // API 金鑰相關狀態
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [keyReady, setKeyReady] = useState(false);

  // 載入時從瀏覽器讀金鑰(逾期會自動清除)
  useEffect(() => {
    const k = loadKey();
    setApiKey(k);
    setKeyReady(true);
  }, []);

  const hasKey = apiKey.trim().length > 0;

  async function analyze() {
    // 「自動」:有金鑰用 Gemini,否則用本地語意(本地 LLM 因需 1GB 下載,不自動觸發)
    const effective = engine === 'auto' ? (hasKey ? 'gemini' : 'semantic') : engine;

    // 只有明確選 Gemini 卻沒金鑰時才擋下(自動模式不會走到這)
    if (effective === 'gemini' && !hasKey) {
      setShowSettings(true);
      setError('Gemini 模式需要金鑰。你也可以改用「自動」「本地語意」或「本地 LLM」,無需金鑰。');
      return;
    }
    setError('');
    setData(null);
    setProgress(null);
    setLoading(true);
    try {
      // 1. 取得要分析的文字(貼網址時透過 /api/fetch 代抓)
      let content = '';
      let sourceTitle = '';
      if (mode === 'url') {
        const res = await fetch('/api/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const j = await res.json();
        if (!res.ok) {
          setError(j.error || '抓取網頁失敗');
          setLoading(false);
          return;
        }
        content = j.text;
        sourceTitle = j.title || '';
      } else {
        content = text.trim();
      }

      if (!content || content.length < 15) {
        setError('內容太短,請提供更完整的新聞內容');
        setLoading(false);
        return;
      }

      // 2. 關鍵字命中(供結果標籤參考,各模式共用)
      const keyword = keywordMatch(content)
        .filter((k) => k.hits > 0)
        .sort((a, b) => b.hits - a.hits);

      // 3. 依所選引擎判斷
      let ai = [];
      let aiError = null;
      let usedAI = false;
      let usedModel = null;
      try {
        if (effective === 'gemini') {
          const out = await classifyWithGemini(content, apiKey);
          ai = out.results;
          usedModel = out.model;
          touchKey();
        } else if (effective === 'semantic') {
          setProgress({ percent: null, text: '語意分析中…' });
          const out = await classifySemantic(content, (p) => setProgress(p));
          ai = out.results;
          usedModel = out.model;
          if (out.source === 'local' && out.note) aiError = out.note; // 改用本機的提示
        }
        usedAI = true;
      } catch (e) {
        aiError = e.message;
      } finally {
        setProgress(null);
      }

      // 4. 組合結果(AI 為主,失敗時退回關鍵字)
      let results;
      if (usedAI && ai.length > 0) {
        results = ai.map((r) => {
          const kw = keyword.find((k) => k.id === r.id);
          return { ...r, matched: kw ? kw.matched : [] };
        });
      } else {
        const maxHits = Math.max(1, ...keyword.map((k) => k.hits));
        results = keyword.map((k) => ({
          id: k.id,
          name: k.name,
          en: k.en,
          color: k.color,
          score: Math.round((k.hits / maxHits) * 100),
          reason: `命中關鍵字:${k.matched.join('、')}`,
          matched: k.matched,
        }));
        if (!usedAI && !aiError) aiError = '此模式未產生結果,改顯示關鍵字快篩。';
      }

      setData({ results, usedAI, usedModel, aiError, sourceTitle, engine: effective, auto: engine === 'auto' });
    } catch (e) {
      setError('發生問題:' + e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const canSubmit = mode === 'url' ? url.trim().length > 0 : text.trim().length > 0;

  return (
    <div className="wrap">
      <div className="topbar">
        <button className="key-btn" onClick={() => setShowSettings((v) => !v)}>
          {hasKey ? '🔑 API 金鑰 ✓' : '🔑 設定 API 金鑰'}
        </button>
      </div>

      <div className="engine-toggle">
        <button
          className="engine-toggle-btn"
          onClick={() => setShowEngines((v) => !v)}
        >
          判斷模式:<strong>{ENGINES[engine].label}</strong> {showEngines ? '▴ 收合' : '▾ 切換'}
        </button>
      </div>
      {showEngines ? (
        <>
          <div className="engine-row">
            {Object.entries(ENGINES).map(([key, e]) => (
              <button
                key={key}
                className={'engine-btn' + (engine === key ? ' active' : '')}
                onClick={() => setEngine(key)}
                disabled={loading}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="engine-hint">{engineHint(engine)}</div>
        </>
      ) : null}

      <div className="header">
        <h1>
          SDGs 新聞分析器<span className="dot">.</span>
        </h1>
        <p>貼上新聞內容或網址,自動判斷它對應哪些聯合國永續發展目標(SDGs)</p>
      </div>

      {keyReady && showSettings ? (
        <ApiKeyPanel
          apiKey={apiKey}
          onSave={(k) => {
            saveKey(k);
            setApiKey(k);
            setShowSettings(false);
            setError('');
          }}
          onClear={() => {
            clearKey();
            setApiKey('');
          }}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      <div className="panel">
        <div className="tabs">
          <button
            className={'tab' + (mode === 'text' ? ' active' : '')}
            onClick={() => setMode('text')}
          >
            貼文字
          </button>
          <button
            className={'tab' + (mode === 'url' ? ' active' : '')}
            onClick={() => setMode('url')}
          >
            貼網址
          </button>
        </div>

        {mode === 'text' ? (
          <textarea
            placeholder="把新聞的標題與內文貼在這裡…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <input
            type="text"
            placeholder="https://example.com/news/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && analyze()}
          />
        )}

        <button className="btn" onClick={analyze} disabled={!canSubmit || loading}>
          {loading ? <span className="spinner" /> : null}
          {loading ? '分析中…' : '開始分析'}
        </button>

        {loading && progress ? (
          <div className="progress">
            <div className="progress-text">
              {progress.text}
              {typeof progress.percent === 'number' ? ` ${progress.percent}%` : ''}
            </div>
            <div className="progress-bar">
              <span style={{ width: (progress.percent || 0) + '%' }} />
            </div>
          </div>
        ) : null}

        {error ? <div className="error">{error}</div> : null}
      </div>

      {data ? <Results data={data} /> : null}

      <div className="footer">
        三種判斷模式:Gemini 雲端 / 本地語意 / 本地 LLM · 共 17 項 SDGs<br />
        你的 API 金鑰只儲存在這台裝置的瀏覽器,不會上傳保存;超過 {INACTIVITY_DAYS} 天未使用會自動清除。
      </div>
    </div>
  );
}

function engineHint(engine) {
  if (engine === 'auto')
    return '⚡ 自動挑選:有設定 Gemini 金鑰就用 Gemini(最準),否則用語意模式(免金鑰)。';
  if (engine === 'gemini')
    return '☁️ 用你的 Gemini 金鑰雲端判斷,最準確、附判斷理由。';
  return '🧠 免金鑰語意判斷:優先用雲端模型(免下載、秒開);免費額度用完會自動改用瀏覽器本機模型。只給相關度、無理由。';
}

function ApiKeyPanel({ apiKey, onSave, onClear, onClose }) {
  const [input, setInput] = useState(apiKey || '');
  const [show, setShow] = useState(false);
  const info = typeof window !== 'undefined' ? getKeyInfo() : null;

  return (
    <div className="keypanel">
      <div className="keypanel-head">
        <strong>🔑 Gemini API 金鑰設定</strong>
        <button className="x" onClick={onClose} aria-label="關閉">
          ✕
        </button>
      </div>

      <p className="keypanel-desc">
        本網站不提供金鑰,請使用你自己的 Gemini API 金鑰。免費申請:{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>
        。金鑰只會存在你這台裝置的瀏覽器。
      </p>

      <div className="keypanel-row">
        <input
          type={show ? 'text' : 'password'}
          placeholder="貼上你的 API 金鑰(AIza... 或其他格式)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="ghost" onClick={() => setShow((v) => !v)}>
          {show ? '隱藏' : '顯示'}
        </button>
      </div>

      <div className="keypanel-actions">
        <button
          className="btn-sm primary"
          onClick={() => input.trim() && onSave(input)}
          disabled={!input.trim()}
        >
          儲存金鑰
        </button>
        {apiKey ? (
          <button
            className="btn-sm danger"
            onClick={() => {
              onClear();
              setInput('');
            }}
          >
            移除金鑰
          </button>
        ) : null}
      </div>

      {apiKey && info ? (
        <div className="keypanel-status">
          目前已設定:{info.masked} · 若 {info.inactivityDays} 天未使用將自動清除(剩 {info.daysLeft} 天)
        </div>
      ) : null}
    </div>
  );
}

const ENGINE_BADGE = {
  gemini: '☁️ Gemini 雲端',
  semantic: '🧠 語意',
};

function Results({ data }) {
  const { results, usedAI, usedModel, aiError, sourceTitle, engine, auto } = data;

  return (
    <div className="results">
      <div className="results-head">
        <h2>分析結果</h2>
        {usedAI ? (
          <span className="badge-ai" title={'使用模型:' + usedModel}>
            ✦ {auto ? '⚡自動 → ' : ''}
            {ENGINE_BADGE[engine] || 'AI'} 判斷{usedModel ? `(${usedModel})` : ''}
          </span>
        ) : (
          <span className="badge-kw">關鍵字快篩(AI 未生效)</span>
        )}
      </div>

      {sourceTitle ? <div className="source">來源標題:{sourceTitle}</div> : null}
      {aiError ? <div className="notice">{aiError}</div> : null}

      {results.length > 0 ? (
        <div className="summary">
          <div className="summary-label">符合的 SDGs 項目(共 {results.length} 項)</div>
          <div className="summary-chips">
            {results.map((r) => (
              <span
                key={r.id}
                className="chip"
                style={{ background: r.color }}
                title={r.name}
              >
                <b>{r.id}</b> {r.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {results.length === 0 ? (
        <div className="empty">這篇內容沒有明顯對應到任何 SDGs 目標。</div>
      ) : (
        results.map((r) => (
          <div className="card" key={r.id}>
            <div className="num" style={{ background: r.color }}>
              {r.id}
            </div>
            <div className="card-body">
              <div className="card-title">
                {r.name}
                <span className="card-en">{r.en}</span>
              </div>
              {r.reason ? <div className="card-reason">{r.reason}</div> : null}
              <div className="bar">
                <span style={{ width: r.score + '%', background: r.color }} />
              </div>
              <div className="score">相關度 {r.score}%</div>
              {r.matched && r.matched.length > 0 ? (
                <div className="kw-tags">
                  {r.matched.map((kw) => (
                    <span key={kw}>{kw}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
