/* MusicGraph Supabase 前端配置（公开配置）
   anon key 是公开密钥，可提交到仓库；service role key 严禁出现在本文件/前端。
   未填 anonKey 时前端自动回退静态快照，填好后即走 Supabase 在线模式。 */
window.MG_SUPABASE = {
  url: "https://dbjruzpzqdsibnalaxhc.supabase.co",
  anonKey: "sb_publishable_m_LjZEIUsXsgKohcc2pC8Q_zCILrjV9",
  timeoutMs: 8000
};