import {Prisma} from '@prisma/client';
import {WmsError} from './contracts';
import {requirePositiveQuantity,wmsQuantityLimit} from './rules';
/** Keep the ratio exact. Fractional pieces must be issued in an integral batch. */
export function consumableQuantity(units:string,mainQuantity:number){
 requirePositiveQuantity(mainQuantity,'主商品数量');
 const result=new Prisma.Decimal(units).mul(mainQuantity);
 if(!result.isPositive()||!result.isInteger()||result.gt(wmsQuantityLimit))throw new WmsError('耗材需求须组成完整整数发料批次；不允许截断小数或超量。',422);
 return result.toNumber();
}
