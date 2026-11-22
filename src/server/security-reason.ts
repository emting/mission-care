import {z} from 'zod';
export const securityReasonInput=z.enum(['suspected_disclosure','access_violation','delivery_failure','emergency_lockdown','other']);
