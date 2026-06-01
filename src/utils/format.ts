// 格式化数字
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

// 格式化百分比
export function formatPercent(num: number): string {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

// 格式化日期
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString();
}

// 格式化日期时间
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// 格式化时间戳为相对时间
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return `${seconds}秒前`;
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// 截断字符串
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

// 生成股票代码
export function generateTicker(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const name = filename.replace(/\.[^.]+$/, '').toUpperCase();
  const ext = filename.includes('.') ? filename.split('.').pop()?.toUpperCase() || '' : '';

  const shortName = name.slice(0, 6);
  return ext ? `${shortName}.${ext.slice(0, 3)}` : shortName;
}

// 获取状态颜色
export function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'text-ex-green';
    case 'ipo':
      return 'text-ex-gold';
    case 'delisted':
      return 'text-ex-dim';
    default:
      return 'text-ex-text';
  }
}

// 获取状态背景颜色
export function getStatusBgColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-ex-green/15';
    case 'ipo':
      return 'bg-ex-gold/15';
    case 'delisted':
      return 'bg-ex-dim/15';
    default:
      return 'bg-ex-surface';
  }
}

// 获取涨跌颜色
export function getChangeColor(change: number): string {
  return change >= 0 ? 'text-ex-green' : 'text-ex-red';
}

// 获取涨跌背景颜色
export function getChangeBgColor(change: number): string {
  return change >= 0 ? 'bg-ex-green/10' : 'bg-ex-red/10';
}
