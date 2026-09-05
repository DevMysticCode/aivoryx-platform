import { redirect } from 'next/navigation';

export default function ProcurementIndex() {
  redirect('/procurement/purchase-orders');
}
