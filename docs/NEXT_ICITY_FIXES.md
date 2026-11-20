# 下个版本：iCity 待修

本清单记录 2026-11-20 用户反馈，本轮只核对与记录，不改变运行逻辑。完整版与分享版下次同步处理。

## 角色补写后看不到

已确认的代码路径：
- lib/icity-runtime.ts：普通“叫 TA 写一篇”／自动个人日记由模型输出 world、friends 或 private；draft.visibility 缺失时按 private 保存。
- lib/icity-history.ts：刷新朋友日记明确保存 friends，生成过往私密明确保存 private；不能认定所有“补写后不可见”都是全生成了私密。
- lib/icity-store.ts 的 canReadCity 与 components/diary/icity-app.tsx 的列表筛选同时影响展示；friends 需要实际 iCity 好友关系，角色主页当前还额外限制普通用户只看 world。排查保存结果、作者／日记本归属、好友关系及当前页筛选。

下版要求：正常补写批次保证有若干篇公开或对 user 实际可读的好友日记，不能出现提示成功却正常入口完全看不到的结果；具体数量随批次规模处理。可见内容应在生成时按对应可见范围写作，不把已有私密正文直接改为公开。明确选择“生成过往私密”的入口继续保持私密语义。完成提示应能说明实际补写数量与可见范围，核对结果与页面列表一致。

## 角色选择头像

styles/icity.css 中 .city-avatar-grid .chosen .city-avatar 当前设置 filter:grayscale(1)、opacity:.45 和灰边。

下版改成：选中时用头像外圈标记，保留照片原色与正常透明度；未选中、选中和不可用状态要能区分，日夜主题都可见，不改变头像尺寸和当前轮廓。
