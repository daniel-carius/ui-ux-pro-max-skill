// Erros da API: código estável (para o painel) + mensagem em pt-BR (para a pessoa).

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, 'nao_autenticado', 'Faça login para continuar.'),
  stage: (stage: string) => new AppError(403, 'etapa_pendente', 'Conclua a etapa de login pendente.', { stage }),
  forbidden: (msg = 'Seu cargo não tem permissão para esta ação.') => new AppError(403, 'sem_permissao', msg),
  notFound: (what = 'Registro') => new AppError(404, 'nao_encontrado', `${what} não encontrado.`),
  conflict: (code: string, msg: string) => new AppError(409, code, msg),
  invalid: (msg: string, details?: unknown) => new AppError(400, 'dados_invalidos', msg, details),
  ipBlocked: () => new AppError(403, 'ip_nao_autorizado', 'Seu IP não está na lista de acesso do painel.'),
  csrf: () => new AppError(403, 'requisicao_invalida', 'Requisição sem o cabeçalho de segurança do painel.'),
}

/** Corpo padrão de erro devolvido pela API. */
export interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
}
