const DEFAULT_GLOBAL_CONFIG = {
  baseSpreadsheetName: "Base de dados",
  baseSpreadsheetId: "",
  operationalSpreadsheetId: "",
  operatorName: "Operador",
  credentialsPath: "",
  fixedDataFolder: "C:\\BancoDeArtes",
  panel50SourceRoot: "X:\\FESTAS E EVENTOS\\PAINEIS MARCKETPLACE\\SKUPR50 - PAINEIS REDONDOS 50 X 50\\SKUPR50 - IMPRESSÃO",
  panel50LastInputFolder: "X:\\FESTAS E EVENTOS\\PAINEIS MARCKETPLACE\\SKUPR50 - PAINEIS REDONDOS 50 X 50\\SKUPR50 - IMPRESSÃO\\SKU - ATESTE",
  panel50OrganizedRoot: "X:\\1 - TEMAS ORGANIZADOS",
  panel50DriveLocalRoot: "X:\\2 - DRIVE",
  panel50MockupPath: "",
  financialClientRoot: "Z:\\2 - ARMAZEM FESTAS E EVENTOS",
  sessionTimeoutMinutes: 10,
  reservationTtlMinutes: 5,
  cadastroSheetName: "Página1",
  operationalLogsSheetName: "LOGS",
  driveFolderName: "BANCO DE ARTES",
  localImageFolders: ["imagens", "imagem"],
  acceptedExtensions: [".jpg", ".jpeg", ".jpe", ".png", ".webp", ".tif", ".tiff"],
  maintenanceMode: false,
  publicDriveUploads: true,
  allowManualBatch: true,
  validProducts: ["PAINEL REDONDO", "PAINEL", "CENARIO", "KIT", "ROMANO", "RETANGULO", "KIT MAIS ROMANO"],
  productSizes: {
    "PAINEL REDONDO": ["50X50"],
    PAINEL: ["50X50", "150X150"],
    CENARIO: ["150X360", "2X1"],
    KIT: ["PADRÃO"],
    ROMANO: ["150X360", "2X1"],
    RETANGULO: ["150X360", "2X1"],
    "KIT MAIS ROMANO": ["PADRÃO"]
  },
};

const BASE_SHEETS = {
  users: {
    name: "USUARIOS",
    header: ["LOGIN", "NOME", "TIPO", "ATIVO", "SENHA_HASH"],
  },
  config: {
    name: "CONFIG",
    header: ["CHAVE", "VALOR"],
  },
  adminLogs: {
    name: "LOGS_ADMIN",
    header: ["DATA_HORA", "USUARIO", "TIPO", "ACAO", "DETALHES", "MAQUINA", "IP_LOCAL"],
  },
  execution: { name: "Execução", header: ["STATUS", "USUARIO", "MAQUINA", "DATA_HORA", "TOKEN", "TIPO", "SESSIONS_JSON", "RESERVATIONS_JSON"] },
};

const OPERATIONAL_SHEETS = {
  cadastroHeader: [
    "ID_TEMA",
    "NOME_DO_TEMA",
    "PRODUTO",
    "TAMANHO",
    "CLIENTE",
    "CADASTRADO_POR",
    "TELEFONE",
    "DATA_CADASTRO",
    "URL DA IMAGEM",
  ],
  logsHeader: ["DATA_HORA", "USUARIO", "TIPO", "ACAO", "DETALHES", "MAQUINA", "IP_LOCAL"],
};

module.exports = {
  DEFAULT_GLOBAL_CONFIG,
  BASE_SHEETS,
  OPERATIONAL_SHEETS,
};
