import { memo } from 'react';
import type { DeliveryStatus } from './types';

interface Props {
  status?: DeliveryStatus;
  isUser: boolean;
}

function DeliveryTicksInner({ status, isUser }: Props) {
  if (!isUser || !status) return null;
  const base = 'inline-block ml-1 align-middle';
  if (status === 'pending') {
    return <svg className={`${base} opacity-55`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
  }
  if (status === 'sent') {
    return <svg className={`${base} opacity-55`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
  }
  if (status === 'delivered') {
    return <svg className={`${base} opacity-55`} width="16" height="14" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/><polyline points="26 6 15 17 12 14"/></svg>;
  }
  if (status === 'read') {
    return <svg className={`${base} text-sky-400`} width="16" height="14" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/><polyline points="26 6 15 17 12 14"/></svg>;
  }
  return null;
}

export const DeliveryTicks = memo(DeliveryTicksInner);
