import { User as LucideUser } from 'lucide-react';
import React, { useState } from 'react';

export default function AccountAvatar({ url }: { url?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <span className="mobile-account-avatar" aria-hidden="true">
    {url && url !== failedUrl
      ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      : <LucideUser width="24" height="24" stroke="currentColor" aria-hidden="true" />}
  </span>;
}
