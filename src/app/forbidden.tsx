import Link from 'next/link';
export default function Forbidden(){return <main className="standalone-error"><section className="panel error-state"><span className="eyebrow">403 · 權限不足</span><h1>此工作不在目前授權範圍內</h1><p>導覽隱藏不代表放寬存取。服務端已重新檢查目前職務、有效期限與範圍。</p><Link className="button" href="/admin">返回管理總覽</Link></section></main>;}
