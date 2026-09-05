//----------------------------------------------------------------------------------------------------------------------
// IP Addresses
//
// Parsing and comparison only -- who to believe about an address is the rate-limit engine's call, not this file's.
//----------------------------------------------------------------------------------------------------------------------

import { BlockList, isIPv4, isIPv6 } from 'node:net';

// Models
import { IPV6_BUCKET_PREFIX } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV6_GROUPS = 8;
const BITS_PER_IPV6_GROUP = 16;

export type IPFamily = 'ipv4' | 'ipv6';

export interface ProxyEntry
{
    address : string;
    prefix : number;
    family : IPFamily;
}

//----------------------------------------------------------------------------------------------------------------------

// One address in the single spelling everything downstream compares against: no zone index, IPv4-mapped IPv6 unwrapped
// to the IPv4 it carries, lowercase. Anything that is not an address comes back null rather than becoming a bucket key
// of its own.
export function normalizeAddress(value : string | null | undefined) : string | null
{
    if(typeof value !== 'string') { return null; }

    const trimmed = value.trim()
        .toLowerCase();
    const withoutZone = trimmed.split('%')[0] ?? '';

    // A socket peer reaching a dual-stack listener arrives as ::ffff:203.0.113.5; the same client on an IPv4 listener
    // arrives as 203.0.113.5. They are one client and must key one bucket.
    if(withoutZone.startsWith(IPV4_MAPPED_PREFIX))
    {
        const mapped = withoutZone.slice(IPV4_MAPPED_PREFIX.length);
        if(isIPv4(mapped)) { return mapped; }
    }

    if(isIPv4(withoutZone) || isIPv6(withoutZone)) { return withoutZone; }

    return null;
}

export function familyOf(address : string) : IPFamily | null
{
    if(isIPv4(address)) { return 'ipv4'; }
    if(isIPv6(address)) { return 'ipv6'; }

    return null;
}

// A single address or a CIDR range, or null when the text is neither. A bare address is its own /32 or /128.
export function parseProxyEntry(entry : string) : ProxyEntry | null
{
    const [ address, prefixText, ...rest ] = entry.trim()
        .toLowerCase()
        .split('/');

    if(rest.length > 0 || address === undefined) { return null; }

    const normalized = normalizeAddress(address);
    if(normalized === null) { return null; }

    const family = familyOf(normalized);
    if(family === null) { return null; }

    const maxPrefix = family === 'ipv4' ? 32 : 128;
    if(prefixText === undefined) { return { address: normalized, prefix: maxPrefix, family }; }

    if(!/^\d{1,3}$/.test(prefixText)) { return null; }

    const prefix = Number(prefixText);
    if(prefix > maxPrefix) { return null; }

    return { address: normalized, prefix, family };
}

//----------------------------------------------------------------------------------------------------------------------

// The proxies a deployment named, as a membership test. Empty is a meaningful state and the common one: a FileShed
// reachable directly trusts no proxy, so every forwarded header is a lie until an operator says otherwise.
export class TrustedProxies
{
    #list = new BlockList();
    #count = 0;

    constructor(entries : readonly string[])
    {
        for(const entry of entries)
        {
            const parsed = parseProxyEntry(entry);
            if(parsed !== null)
            {
                this.#list.addSubnet(parsed.address, parsed.prefix, parsed.family);
                this.#count += 1;
            }
        }
    }

    get isEmpty() : boolean
    {
        return this.#count === 0;
    }

    trusts(address : string | null) : boolean
    {
        if(address === null || this.#count === 0) { return false; }

        const family = familyOf(address);
        if(family === null) { return false; }

        return this.#list.check(address, family);
    }
}

//----------------------------------------------------------------------------------------------------------------------

// The eight groups of an IPv6 address with :: expanded, or null if it is not one.
function expandIPv6(address : string) : number[] | null
{
    if(!isIPv6(address)) { return null; }

    const [ head, tail, ...rest ] = address.split('::');
    if(rest.length > 0 || head === undefined) { return null; }

    // Only the plain hextet spelling. The dotted-quad tail (64:ff9b::198.51.100.1) is left alone rather than
    // half-parsed -- it keys itself, which costs one bucket to an address nothing in practice arrives as.
    const parse = (text : string) : number[] | null =>
    {
        if(text === '') { return []; }

        const groups = text.split(':');
        if(!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) { return null; }

        return groups.map((group) => Number.parseInt(group, 16));
    };

    const leading = parse(head);
    if(leading === null) { return null; }
    if(tail === undefined) { return leading.length === IPV6_GROUPS ? leading : null; }

    const trailing = parse(tail);
    if(trailing === null) { return null; }

    const gap = IPV6_GROUPS - leading.length - trailing.length;
    if(gap < 0) { return null; }

    return [ ...leading, ...Array<number>(gap).fill(0), ...trailing ];
}

// The address a rate-limit bucket is keyed by. IPv4 keys itself; IPv6 keys its /64, since a single client is
// routinely handed that whole block and rotating inside it would defeat the count.
export function bucketAddress(address : string) : string
{
    const groups = expandIPv6(address);
    if(groups === null) { return address; }

    const kept = IPV6_BUCKET_PREFIX / BITS_PER_IPV6_GROUP;

    return `${ groups.slice(0, kept)
        .map((group) => group.toString(16))
        .join(':') }::/${ IPV6_BUCKET_PREFIX }`;
}

//----------------------------------------------------------------------------------------------------------------------
