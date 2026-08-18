'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';

const navItems = [
  {
    href: '/inbox',
    label: 'Inbox',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
    ),
  },
  {
    href: '/sites',
    label: 'Sites',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    ),
  },
  {
    href: '/test',
    label: 'Test Chat',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    localStorage.removeItem('chat_token');
    router.replace('/login');
  }

  return (
    <aside className="w-16 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-2">
      <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center mb-4">
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
      </div>

      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors group relative',
            pathname.startsWith(item.href)
              ? 'bg-brand-600 text-white'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
          )}
        >
          {item.icon}
          <span className="absolute left-14 bg-gray-900 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-10">
            {item.label}
          </span>
        </Link>
      ))}

      <div className="flex-1" />

      <button
        onClick={handleLogout}
        title="Sign out"
        className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
        </svg>
      </button>
    </aside>
  );
}
