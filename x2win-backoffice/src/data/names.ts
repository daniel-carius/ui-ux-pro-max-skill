export const FIRST_NAMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João',
  'Juliana', 'Karina', 'Leonardo', 'Larissa', 'Marcos', 'Mariana', 'Natália', 'Otávio', 'Paula', 'Rafael',
  'Renata', 'Rodrigo', 'Sabrina', 'Thiago', 'Vanessa', 'Vinícius', 'Wesley', 'Yasmin', 'Lucas', 'Camila',
  'Matheus', 'Beatriz', 'Gustavo', 'Letícia', 'Pedro', 'Amanda', 'André', 'Fernanda', 'Caio', 'Priscila',
  'Igor', 'Aline', 'Daniel', 'Bianca', 'Fábio', 'Jéssica', 'Leandro', 'Tatiane', 'Ricardo', 'Patrícia',
  'Samuel', 'Kelly', 'Murilo', 'Débora', 'Alexandre', 'Raquel', 'Everton', 'Michele', 'Jonathan', 'Luana',
] as const

export const LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes',
  'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa',
  'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas',
  'Cardoso', 'Ramos', 'Gonçalves', 'Santana', 'Teixeira', 'Araújo', 'Pinto', 'Moura', 'Cavalcanti', 'Monteiro',
] as const

export const NICK_PARTS_A = [
  'tigrinho', 'lucky', 'mega', 'rei', 'rainha', 'sorte', 'gold', 'turbo', 'ninja', 'lobo', 'fenix', 'pro',
  'master', 'black', 'neo', 'zika', 'brabo', 'top', 'vip', 'king',
] as const

export const NICK_PARTS_B = [
  'dosgreens', 'bet', 'win', 'spin', 'jackpot', '777', 'game', 'play', 'max', 'br', 'zone', 'one', 'x', 'ace',
] as const

export const CITIES = [
  ['São Paulo', 'SP'], ['Rio de Janeiro', 'RJ'], ['Belo Horizonte', 'MG'], ['Salvador', 'BA'], ['Fortaleza', 'CE'],
  ['Recife', 'PE'], ['Curitiba', 'PR'], ['Porto Alegre', 'RS'], ['Goiânia', 'GO'], ['Manaus', 'AM'],
  ['Belém', 'PA'], ['Campinas', 'SP'], ['Brasília', 'DF'], ['Natal', 'RN'], ['Florianópolis', 'SC'],
] as const

export const EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br', 'icloud.com', 'uol.com.br'] as const

export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}
