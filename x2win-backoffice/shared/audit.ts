// Ações registradas na auditoria. Compartilhado entre painel e servidor.

export type AuditAction =
  | 'login'
  | 'criar'
  | 'editar'
  | 'excluir'
  | 'aprovar'
  | 'recusar'
  | 'exportar'
  | 'ligar'
  | 'desligar'
  | 'convidar'
  | 'desativar'
  | 'enviar'
  | 'testar'
  | 'sincronizar'
  | 'banir'
  | 'bloquear'
  | 'revelar'
  | 'revogar'
  | 'desbloquear'
  | 'creditar'
  | 'estornar'

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  login: 'Entrou no painel',
  criar: 'Criou',
  editar: 'Editou',
  excluir: 'Excluiu',
  aprovar: 'Aprovou',
  recusar: 'Recusou',
  exportar: 'Exportou',
  ligar: 'Ligou',
  desligar: 'Desligou',
  convidar: 'Convidou',
  desativar: 'Desativou',
  enviar: 'Enviou',
  testar: 'Testou',
  sincronizar: 'Sincronizou',
  banir: 'Baniu',
  bloquear: 'Bloqueou',
  revelar: 'Revelou dado sensível',
  revogar: 'Revogou',
  desbloquear: 'Desbloqueou',
  creditar: 'Ajustou saldo',
  estornar: 'Estornou',
}

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === 'string' && v in AUDIT_ACTION_LABEL
}

export interface AuditEntry {
  id: string
  at: string
  actorId: string
  actorName: string
  action: AuditAction
  entity: string
  summary: string
  ip: string
  /** 'servidor' = registrado pela API; 'painel' = relatado pela tela */
  source?: 'servidor' | 'painel'
}
