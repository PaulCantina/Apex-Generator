'use client';

import { useState } from 'react';

export default function Page() {
  const [repoUrl, setRepoUrl] = useState('');
  const [mode, setMode] = useState('standard');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: repoUrl, mode })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: 'Analysis failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem' }}>
      <h1>Apex Impact Calculator</h1>
      <form onSubmit={analyze}>
        <label>
          GitHub Repo URL:
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Mode:
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="conservative">Conservative</option>
            <option value="standard">Standard</option>
            <option value="strong">Strong</option>
          </select>
        </label>
        <button type="submit" disabled={loading}>Analyze</button>
      </form>
      {loading && <p>Analyzing…</p>}
      {result && !('error' in result) && (
        <div>
          <p>Repository size:<br />{result.totalLoc.toLocaleString()} LOC</p>
          <p>Estimated traditional review:<br />{result.w_base.toFixed(1)} reviewer-weeks<br />{result.calendar_base.toFixed(2)} calendar weeks</p>
          <p>With Apex pre-scan:<br />{result.w_apex.toFixed(1)} reviewer-weeks<br />{result.calendar_apex.toFixed(2)} calendar weeks</p>
          <p>Estimated effort reduction:<br />{(result.w_base - result.w_apex).toFixed(1)} reviewer-weeks<br />{((result.calendar_base - result.calendar_apex) / result.calendar_base * 100).toFixed(0)}% calendar acceleration</p>
        </div>
      )}
      {result && 'error' in result && <p>{result.error}</p>}
    </main>
  );
}
