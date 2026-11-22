import { AdminScreen } from '@/server/screens';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{section:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){return <AdminScreen parts={(await params).section} query={await searchParams}/>;}
