import { MemberScreen } from '@/server/screens';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{section:string[]}>}){return <MemberScreen parts={(await params).section}/>;}
