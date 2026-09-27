//! HarmonyOS DNS for the AI and subscription HTTP clients.
//!
//! `getaddrinfo` reads `/etc/resolv.conf`. On HarmonyOS that file can list
//! public resolvers whose packets the active network never answers, so model
//! discovery fails with `EAI_AGAIN` even after the account credential is
//! stored. `OH_NetConn_GetAddrInfo` asks netmanager to resolve on the default
//! network instead. libc remains the fallback when netmanager has no answer.

use std::net::{IpAddr, SocketAddr};

#[cfg(target_env = "ohos")]
use std::ffi::{c_char, CString};

#[cfg(target_env = "ohos")]
use reqwest::dns::{Addrs, Resolve, Resolving};

pub(crate) fn apply_platform_resolver(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    #[cfg(target_env = "ohos")]
    {
        builder.dns_resolver(OhosNetManagerResolver)
    }
    #[cfg(not(target_env = "ohos"))]
    {
        builder
    }
}

#[cfg(any(target_env = "ohos", test))]
pub(crate) fn literal_socket_addrs(host: &str) -> Option<Vec<SocketAddr>> {
    let ip: IpAddr = host.parse().ok()?;
    Some(vec![SocketAddr::new(ip, 0)])
}

#[cfg(any(target_env = "ohos", test))]
pub(crate) fn select_lookup(
    platform: Result<Vec<SocketAddr>, String>,
    libc_lookup: impl FnOnce() -> Result<Vec<SocketAddr>, String>,
) -> Result<Vec<SocketAddr>, String> {
    match platform {
        Ok(addresses) if !addresses.is_empty() => Ok(addresses),
        Ok(_) => libc_lookup(),
        Err(platform_error) => {
            log::warn!("HarmonyOS netmanager DNS failed: {platform_error}; falling back to libc");
            match libc_lookup() {
                Ok(addresses) => Ok(addresses),
                Err(libc_error) => Err(format!("{platform_error}; {libc_error}")),
            }
        }
    }
}

#[cfg(target_env = "ohos")]
#[link(name = "net_connection")]
extern "C" {
    fn OH_NetConn_GetAddrInfo(
        host: *mut c_char,
        serv: *mut c_char,
        hint: *const libc::addrinfo,
        res: *mut *mut libc::addrinfo,
        net_id: i32,
    ) -> i32;

    fn OH_NetConn_FreeDnsResult(res: *mut libc::addrinfo) -> i32;
}

#[cfg(target_env = "ohos")]
#[derive(Clone, Copy)]
struct OhosNetManagerResolver;

#[cfg(target_env = "ohos")]
impl Resolve for OhosNetManagerResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let resolved = tokio::task::spawn_blocking(move || lookup_host(&host))
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> {
                    format!("HarmonyOS DNS task failed: {error}").into()
                })?
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { error.into() })?;
            let addresses: Addrs = Box::new(resolved.into_iter());
            Ok(addresses)
        })
    }
}

#[cfg(target_env = "ohos")]
fn lookup_host(host: &str) -> Result<Vec<SocketAddr>, String> {
    if let Some(addresses) = literal_socket_addrs(host) {
        return Ok(addresses);
    }
    select_lookup(netmanager_lookup(host), || libc_lookup(host))
}

#[cfg(target_env = "ohos")]
fn libc_lookup(host: &str) -> Result<Vec<SocketAddr>, String> {
    use std::net::ToSocketAddrs;
    (host, 0)
        .to_socket_addrs()
        .map(|addresses| {
            addresses
                .map(|address| SocketAddr::new(address.ip(), 0))
                .collect()
        })
        .map_err(|error| format!("libc DNS lookup failed: {error}"))
}

#[cfg(target_env = "ohos")]
fn netmanager_lookup(host: &str) -> Result<Vec<SocketAddr>, String> {
    let host_buf = CString::new(host).map_err(|_| format!("DNS name contains NUL: {host}"))?;
    let serv_buf = CString::new("443").expect("service name is static");
    let mut hints: libc::addrinfo = unsafe { std::mem::zeroed() };
    hints.ai_family = libc::AF_UNSPEC;
    hints.ai_socktype = libc::SOCK_STREAM;
    let mut result: *mut libc::addrinfo = std::ptr::null_mut();
    let rc = unsafe {
        OH_NetConn_GetAddrInfo(
            host_buf.as_ptr() as *mut c_char,
            serv_buf.as_ptr() as *mut c_char,
            &hints,
            &mut result,
            0,
        )
    };
    if rc != 0 {
        return Err(format!("OH_NetConn_GetAddrInfo returned {rc} for {host}"));
    }

    let addresses = socket_addrs_from_addrinfo(result);
    if !result.is_null() {
        let free_rc = unsafe { OH_NetConn_FreeDnsResult(result) };
        if free_rc != 0 {
            log::warn!("OH_NetConn_FreeDnsResult returned {free_rc} for {host}");
        }
    }
    if addresses.is_empty() {
        return Err(format!(
            "OH_NetConn_GetAddrInfo returned no addresses for {host}"
        ));
    }
    log::debug!("resolved {host} via HarmonyOS netmanager: {addresses:?}");
    Ok(addresses)
}

#[cfg(target_env = "ohos")]
fn socket_addrs_from_addrinfo(mut cursor: *mut libc::addrinfo) -> Vec<SocketAddr> {
    let mut addresses = Vec::new();
    while !cursor.is_null() {
        unsafe {
            if let Some(address) = sockaddr_to_socket((*cursor).ai_addr, (*cursor).ai_addrlen) {
                let address = SocketAddr::new(address.ip(), 0);
                if !addresses.contains(&address) {
                    addresses.push(address);
                }
            }
            cursor = (*cursor).ai_next;
        }
    }
    addresses
}

#[cfg(target_env = "ohos")]
fn sockaddr_to_socket(addr: *const libc::sockaddr, len: libc::socklen_t) -> Option<SocketAddr> {
    if addr.is_null() {
        return None;
    }
    unsafe {
        match i32::from((*addr).sa_family) {
            libc::AF_INET if len as usize >= std::mem::size_of::<libc::sockaddr_in>() => {
                let value = &*(addr as *const libc::sockaddr_in);
                let ip = std::net::Ipv4Addr::from(value.sin_addr.s_addr.to_ne_bytes());
                Some(SocketAddr::new(IpAddr::V4(ip), 0))
            }
            libc::AF_INET6 if len as usize >= std::mem::size_of::<libc::sockaddr_in6>() => {
                let value = &*(addr as *const libc::sockaddr_in6);
                let ip = std::net::Ipv6Addr::from(value.sin6_addr.s6_addr);
                Some(SocketAddr::new(IpAddr::V6(ip), 0))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{literal_socket_addrs, select_lookup};
    use std::net::{Ipv4Addr, SocketAddr};

    #[test]
    fn literal_hosts_skip_dns() {
        let addresses = literal_socket_addrs("1.2.3.4").expect("ipv4 literal");
        assert_eq!(
            addresses,
            vec![SocketAddr::new(Ipv4Addr::new(1, 2, 3, 4).into(), 0)]
        );
        assert!(literal_socket_addrs("chatgpt.com").is_none());
    }

    #[test]
    fn platform_addresses_win_over_libc() {
        let platform = Ok(vec![SocketAddr::new(Ipv4Addr::new(9, 9, 9, 9).into(), 0)]);
        let selected = select_lookup(platform, || {
            panic!("libc lookup must not run when netmanager returned addresses")
        })
        .expect("platform addresses");
        assert_eq!(selected[0].ip(), Ipv4Addr::new(9, 9, 9, 9));
    }

    #[test]
    fn empty_platform_result_uses_libc() {
        let selected = select_lookup(Ok(Vec::new()), || {
            Ok(vec![SocketAddr::new(Ipv4Addr::new(8, 8, 8, 8).into(), 0)])
        })
        .expect("libc addresses");
        assert_eq!(selected[0].ip(), Ipv4Addr::new(8, 8, 8, 8));
    }

    #[test]
    fn platform_failure_keeps_the_libc_error() {
        let error = select_lookup(
            Err("OH_NetConn_GetAddrInfo returned 2100003 for chatgpt.com".to_string()),
            || {
                Err(
                    "libc DNS lookup failed: failed to lookup address information: Try again"
                        .to_string(),
                )
            },
        )
        .expect_err("both resolvers failed");
        assert!(error.contains("2100003"));
        assert!(error.contains("Try again"));
    }
}
