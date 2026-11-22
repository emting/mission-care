import { handler } from '@/server/http';
import { workflowHandler } from '@/server/workflow-http';
export const GET = handler('letters');
export const POST = workflowHandler;
