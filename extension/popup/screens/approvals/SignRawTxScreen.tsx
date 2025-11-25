import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { INTERNAL_METHODS, APPROVAL_CONSTANTS } from '../../../shared/constants';
import { send } from '../../utils/messaging';
import { SignRawTxRequest } from '../../../shared/types';

export function SignRawTxScreen() {
    const { pendingSignRequest, setPendingSignRequest, navigate } = useStore();
    const [request, setRequest] = useState<SignRawTxRequest | null>(null);

    useEffect(() => {
        // Check if we have a pending request in store
        if (pendingSignRequest && 'rawTx' in pendingSignRequest) {
            setRequest(pendingSignRequest as unknown as SignRawTxRequest);
            return;
        }

        // Otherwise fetch from background
        const fetchRequest = async () => {
            try {
                const hash = window.location.hash.slice(1);
                const prefix = APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX;

                if (hash.startsWith(prefix)) {
                    const requestId = hash.slice(prefix.length);
                    const req = await send<SignRawTxRequest>(INTERNAL_METHODS.GET_PENDING_RAW_TX_REQUEST, [requestId]);
                    setRequest(req);
                    setPendingSignRequest(req as any);
                }
            } catch (error) {
                console.error('Failed to fetch request:', error);
            }
        };

        fetchRequest();
    }, [pendingSignRequest, setPendingSignRequest]);

    const handleApprove = async () => {
        if (!request) return;

        try {
            await send(INTERNAL_METHODS.APPROVE_SIGN_RAW_TX, [request.id]);
            window.close();
        } catch (error) {
            console.error('Failed to approve:', error);
        }
    };

    const handleReject = async () => {
        if (!request) return;

        try {
            await send(INTERNAL_METHODS.REJECT_SIGN_RAW_TX, [request.id]);
            window.close();
        } catch (error) {
            console.error('Failed to reject:', error);
            window.close();
        }
    };

    if (!request) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-surface-50">
            <div className="flex-1 p-6 overflow-y-auto">
                <div className="flex flex-col items-center mb-6">
                    <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center mb-4">
                        <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 text-center">Sign Transaction</h2>
                    <p className="text-sm text-gray-500 mt-1 text-center break-all">{request.origin}</p>
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Transaction Details</h3>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Notes</span>
                            <span className="text-sm font-medium text-gray-900">{request.notes.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Spend Conditions</span>
                            <span className="text-sm font-medium text-gray-900">{request.spendConditions.length}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-100">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <h3 className="text-sm font-medium text-yellow-800">Warning</h3>
                            <div className="mt-2 text-sm text-yellow-700">
                                <p>Only sign transactions from sites you trust. Malicious sites can drain your wallet.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-6 bg-white border-t border-gray-100">
                <div className="flex space-x-4">
                    <button
                        onClick={handleReject}
                        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
                    >
                        Reject
                    </button>
                    <button
                        onClick={handleApprove}
                        className="flex-1 px-4 py-3 bg-primary-600 rounded-lg text-white font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors shadow-sm"
                    >
                        Sign
                    </button>
                </div>
            </div>
        </div>
    );
}
