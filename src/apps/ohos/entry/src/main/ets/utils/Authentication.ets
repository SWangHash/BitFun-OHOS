import { hilog } from '@kit.PerformanceAnalysisKit';
import { accountManager } from '@kit.AccountKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN = 0x0000;
const TAG = '[BitFunAuthentication]';

export interface AuthResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  userInfo?: {
    id?: string;
    name?: string;
  };
}

let cachedAuthResult: AuthResult | null = null;

export async function checkHuaweiAccountAuth(): Promise<AuthResult> {
  if (cachedAuthResult !== null) {
    hilog.info(DOMAIN, TAG, 'Using cached auth result: %{public}s', cachedAuthResult.success ? 'success' : 'failed');
    return cachedAuthResult;
  }

  try {
    hilog.info(DOMAIN, TAG, 'Starting Huawei account authentication check');
    
    const osAccountManager = accountManager.getOsAccountManager();
    const accountInfo = await osAccountManager.getOsAccountInfo();
    
    if (accountInfo && accountInfo.localId > 0) {
      hilog.info(DOMAIN, TAG, 'Account check success: localId=%{public}d', accountInfo.localId);
      
      cachedAuthResult = {
        success: true,
        userInfo: {
          id: String(accountInfo.localId),
          name: accountInfo.localName || undefined
        }
      };
      return cachedAuthResult;
    }
    
    hilog.warn(DOMAIN, TAG, 'Account check failed: no valid account info');
    cachedAuthResult = {
      success: false,
      errorCode: 'NO_ACCOUNT',
      errorMessage: 'No Huawei account logged in'
    };
    return cachedAuthResult;
    
  } catch (error) {
    const err = error as BusinessError;
    hilog.error(DOMAIN, TAG, 'Account authentication error: %{public}d, %{public}s', err.code, err.message);
    
    cachedAuthResult = {
      success: false,
      errorCode: String(err.code),
      errorMessage: err.message || 'Authentication failed'
    };
    return cachedAuthResult;
  }
}

export function clearAuthCache(): void {
  cachedAuthResult = null;
  hilog.info(DOMAIN, TAG, 'Auth cache cleared');
}

export async function performAuthCheck(): Promise<string> {
  const result = await checkHuaweiAccountAuth();
  const response = JSON.stringify(result);
  hilog.info(DOMAIN, TAG, 'Auth check response: %{public}s', response);
  return response;
}