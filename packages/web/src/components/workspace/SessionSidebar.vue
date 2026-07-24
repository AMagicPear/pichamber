<template>
  <aside class="sidebar">
    <div class="sidebar__topbar">
      <button type="button" aria-label="Toggle sidebar">◧</button>
      <button type="button" aria-label="Search">⌕</button>
      <button type="button" aria-label="More">⌄</button>
    </div>

    <div class="sidebar__actions" aria-label="Workspace actions">
      <button type="button">＋</button>
      <button type="button">□</button>
      <button type="button">⌘</button>
      <button type="button">◷</button>
      <button type="button">⌕</button>
      <button type="button">☑</button>
      <button type="button">≡</button>
      <button type="button">☷</button>
    </div>

    <section class="session-list">
      <h2>⌄ Recent</h2>
      <button type="button" class="session-list__item">
        <span>复杂格式示例：表格、代码、...</span>
        <time>13h</time>
      </button>
      <button type="button" class="session-list__item">
        <span>Skill 安装位置选择与指南</span>
        <time>4mo</time>
      </button>
      <button type="button" class="session-list__item">
        <span>Home 目录可清理文件检查</span>
        <time>4mo</time>
      </button>
      <button type="button" class="session-list__item">
        <span>New Computer Setup Request</span>
        <time>6mo</time>
      </button>
      <button type="button" class="session-list__item">
        <span>Analyzing Plan-Mode Read...</span>
        <time>6mo</time>
      </button>
      <button type="button" class="session-list__more">Show more sessions</button>
    </section>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 100%;
  height: 100%;
  overflow: auto;
  color: #1f1f1f;
}
.sidebar__topbar,
.sidebar__actions {
  display: flex;
  align-items: center;
}
.sidebar__topbar {
  gap: 10px;
  padding: 18px 16px;
}
.sidebar__topbar button {
  min-width: 32px;
  height: 32px;
  font-size: 24px;
}
.sidebar__topbar button:nth-child(2) {
  width: 64px;
  border: 1px solid #dfddd4;
  border-radius: 12px 0 0 12px;
}
.sidebar__actions {
  justify-content: space-between;
  padding: 18px 16px 16px;
  font-size: 22px;
}
.session-list {
  padding: 0 16px;
}
.session-list h2 {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 500;
}
.session-list__item {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 9px 12px;
  text-align: left;
  font-size: 15px;
}
.session-list__item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-list__item time {
  margin-left: 8px;
  color: #888;
  white-space: nowrap;
}
.session-list__more {
  padding: 10px 12px;
  color: #888;
}
</style>
