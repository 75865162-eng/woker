import { requireText, strictKeys, WmsInputError } from '@/lib/wms/rules';
import { object } from './rules';

function timestamp(raw: unknown, label: string) {
  const value = requireText(raw, label);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new WmsInputError(`${label}须为带时区的 ISO 时间。`);
  const calendar = new Date(`${value.slice(0,10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== value.slice(0,10)) throw new WmsInputError(`${label}日期无效。`);
  return new Date(value).toISOString();
}
function optionalText(raw: unknown, label: string) { return raw === null || raw === undefined || raw === '' ? null : requireText(raw, label); }
function optionalTime(raw: unknown, label: string) { return raw === null || raw === undefined || raw === '' ? null : timestamp(raw, label); }

export function parseForwarderOrder(raw: unknown) {
  const value = object(raw);
  strictKeys(value, ['number','forwarder','channel','mode','destination','containerNumber','billOfLading','vesselOrFlight','cutoffAt','departureEta','arrivalEta','idempotencyKey']);
  const mode = requireText(value.mode,'运输方式');
  if (!['OCEAN','AIR','ROAD','RAIL'].includes(mode)) throw new WmsInputError('运输方式无效。');
  const result = { number:requireText(value.number,'委托单号'),forwarder:requireText(value.forwarder,'货代'),channel:requireText(value.channel,'运输渠道'),mode,destination:requireText(value.destination,'目的地址'),
    containerNumber:optionalText(value.containerNumber,'柜号'),billOfLading:optionalText(value.billOfLading,'提单号'),vesselOrFlight:optionalText(value.vesselOrFlight,'船名航次/航班'),
    cutoffAt:optionalTime(value.cutoffAt,'截单时间'),departureEta:optionalTime(value.departureEta,'预计起运时间'),arrivalEta:optionalTime(value.arrivalEta,'预计到达时间'),idempotencyKey:requireText(value.idempotencyKey,'幂等键') };
  if (result.cutoffAt && result.departureEta && result.cutoffAt > result.departureEta) throw new WmsInputError('截单时间不能晚于预计起运时间。');
  if (result.departureEta && result.arrivalEta && result.departureEta > result.arrivalEta) throw new WmsInputError('预计到达时间不能早于起运时间。');
  return result;
}
export function parseTrackingEvent(raw: unknown, now = Date.now()) {
  const value = object(raw);
  strictKeys(value,['eventType','occurredAt','location','evidence','idempotencyKey']);
  const eventType = requireText(value.eventType,'物流节点');
  if (!['DEPARTED','ARRIVED','CLEARED','DELIVERED','NOTE'].includes(eventType)) throw new WmsInputError('物流节点无效。');
  const occurredAt = timestamp(value.occurredAt,'发生时间');
  if (Date.parse(occurredAt) > now + 300000) throw new WmsInputError('实际物流节点不能录入未来时间。');
  return { eventType,occurredAt,location:requireText(value.location,'节点地点'),evidence:requireText(value.evidence,'凭据或来源说明',2000),idempotencyKey:requireText(value.idempotencyKey,'幂等键') };
}

export function nextTransportStatus(status: string, eventType: string) {
  if (['DELIVERED','CANCELLED'].includes(status)) throw new WmsInputError('已送达或已取消的委托单不能追加轨迹。',409);
  if (eventType === 'NOTE' && ['BOOKED','IN_TRANSIT','ARRIVED','CLEARED'].includes(status)) return status;
  const next = ({BOOKED:{DEPARTED:'IN_TRANSIT'},IN_TRANSIT:{ARRIVED:'ARRIVED',DELIVERED:'DELIVERED'},ARRIVED:{CLEARED:'CLEARED',DELIVERED:'DELIVERED'},CLEARED:{DELIVERED:'DELIVERED'}} as Record<string,Record<string,string>>)[status]?.[eventType];
  if (!next) throw new WmsInputError('物流节点与当前运输状态不匹配。',409);
  return next;
}
