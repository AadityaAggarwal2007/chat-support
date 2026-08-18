'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem('chat_token');
    router.replace(token ? '/inbox' : '/login');
  }, [router]);
  return null;
}
