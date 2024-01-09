import {JSONEncoder} from 'assemblyscript-json'
import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  dataSource,
  json,
  JSONValue,
  JSONValueKind,
  log,
  TypedMap
} from '@graphprotocol/graph-ts'
import {
  BurnBatchCall,
  BurnCall,
  MintBatchCall,
  MintCall,
  SafeBatchTransferFromCall,
  SafeTransferFromCall,
  UpdateConfigurationCall,
  UpdateOperatingAgreementCall,
  UpdateValidatorCall,
} from '../generated/FabricaToken/FabricaToken'
import {
  Balance,
  ConfigurationUpdate,
  Coordinates,
  FabricaToken,
  FabricaTokenConfiguration,
  FabricaTokenDefinition,
  FabricaTokenDocument,
  FabricaTokenMedia,
  OffchainRegistrar,
  OperatingAgreementUpdate,
  ProofOfTitle,
  Transfer,
  ValidatorUpdate,
  Wallet,
} from '../generated/schema'
import {
  FabricaTokenConfiguration as FabricaTokenConfigurationTemplate,
  FabricaTokenDefinition as FabricaTokenDefinitionTemplate,
} from '../generated/templates'

export const FABRICA_1155_TOKEN_ADDRESSES: Array<Bytes> = [
  Address.fromHexString('0xb52ED2Dc8EBD49877De57De3f454Fd71b75bc1fD'),
]
const LOAN_CONTRACT_ADDRESSES: Array<Bytes> = []

export function handleBurn(call: BurnCall): void {
  if (LOAN_CONTRACT_ADDRESSES.includes(call.inputs.from)
  ) {
    return
  }
  const tokenId = call.inputs.id
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
  const transfer = new Transfer(
    call.transaction.hash.concatI32(call.transaction.index.toI32())
  )
  transfer.operator = call.from
  transfer.from = call.inputs.from
  transfer.to = null
  transfer.token = tokenIdBytes
  transfer.blockNumber = call.block.number
  transfer.blockTimestamp = call.block.timestamp
  transfer.transactionHash = call.transaction.hash
  transfer.value = call.inputs.amount
  transfer.save()
  let token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Burn call for token ${tokenId}, but no token found`)
  }
  let from = Wallet.load(call.inputs.from)
  if (from == null) {
    throw new Error('Wallet doesn\'t exist for from address during token burn')
  }
  if (from.tokenCount.lt(BigInt.fromI32(1))) {
    throw new Error('From wallet has zero tokenCount during token transfer')
  }
  const balanceId = call.inputs.from.concat(call.inputs.from).concat(tokenIdBytes)
  let balance = Balance.load(balanceId)
  if (balance == null) {
    throw new Error('Balance doesn\'t exist for from address')
  } else {
    const newBalance = balance.balance.minus(call.inputs.amount)
    balance.balance = newBalance
    if (newBalance.equals(BigInt.zero())) {
      from.tokenCount = from.tokenCount.minus(BigInt.fromI32(1))
    }
  }
  balance.save()
  from.save()
  token.supply = token.supply.minus(call.inputs.amount)
  token.save()
}

export function handleBurnBatch(call: BurnBatchCall): void {
  if (LOAN_CONTRACT_ADDRESSES.includes(call.inputs.from)) {
    return
  }
  for (let i = 0; i < call.inputs.ids.length; i++) {
    const tokenId = call.inputs.ids[i]
    const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
    const transfer = new Transfer(
        call.transaction.hash.concatI32(call.transaction.index.toI32()).concatI32(i)
    )
    transfer.operator = call.from
    transfer.from = call.inputs.from
    transfer.to = null
    transfer.token = tokenIdBytes
    transfer.blockNumber = call.block.number
    transfer.blockTimestamp = call.block.timestamp
    transfer.transactionHash = call.transaction.hash
    transfer.value = call.inputs.amounts[i]
    transfer.save()
    let token = FabricaToken.load(tokenIdBytes)
    if (token == null) {
      throw new Error(`Burn call for token ${tokenId}, but no token found`)
    }
    let from = Wallet.load(call.inputs.from)
    if (from == null) {
      throw new Error('Wallet doesn\'t exist for from address during token burn')
    }
    if (from.tokenCount.lt(BigInt.fromI32(1))) {
      throw new Error('From wallet has zero tokenCount during token burn')
    }
    const balanceId = call.inputs.from.concat(call.inputs.from).concat(tokenIdBytes)
    let balance = Balance.load(balanceId)
    if (balance == null) {
      throw new Error('Balance doesn\'t exist for from address')
    } else {
      const newBalance = balance.balance.minus(call.inputs.amounts[i])
      balance.balance = newBalance
      if (newBalance.equals(BigInt.zero())) {
        from.tokenCount = from.tokenCount.minus(BigInt.fromI32(1))
      }
    }
    balance.save()
    from.save()
    token.supply = token.supply.minus(call.inputs.amounts[i])
    token.save()
  }
}

export function handleMint(call: MintCall): void {
  const tokenId = call.outputs.value0
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
  let token = FabricaToken.load(tokenIdBytes)
  if (token != null) {
    throw new Error(`Mint call for token ${tokenId}, but token already exists`)
  }
  token = new FabricaToken(tokenIdBytes)
  const definitionUrl = call.inputs.definition
  token.definitionUrl = definitionUrl
  const definitionUrlParts = definitionUrl.split('/')
  const definitionIpfsHash = definitionUrlParts[definitionUrlParts.length - 1]
  token.definition = Bytes.fromUTF8(definitionIpfsHash)
  FabricaTokenDefinitionTemplate.create(definitionIpfsHash)
  token.tokenId = tokenId
  let lastAmount = BigInt.zero()
  let totalSupply = BigInt.zero()
  for (let recipientIndex = 0; recipientIndex < call.inputs.recipients.length; recipientIndex++) {
    const recipientAddress = call.inputs.recipients[recipientIndex]
    if (LOAN_CONTRACT_ADDRESSES.includes(recipientAddress)) {
      continue
    }
    let recipient = Wallet.load(recipientAddress)
    if (recipient == null) {
      recipient = new Wallet(recipientAddress)
      recipient.address = recipientAddress
      recipient.tokenCount = BigInt.fromI32(1)
    }
    const amount = call.inputs.amounts[recipientIndex]
    if (amount.gt(lastAmount)) {
      token.creator = recipientAddress
    }
    lastAmount = amount
    totalSupply = totalSupply.plus(amount)
    const balanceId = recipientAddress.concat(recipientAddress).concat(tokenIdBytes)
    let balance = Balance.load(balanceId)
    if (balance == null) {
      balance = new Balance(balanceId)
      balance.token = tokenIdBytes
      balance.owner = recipientAddress
      balance.holder = recipientAddress
      balance.balance = amount
      recipient.tokenCount = recipient.tokenCount.plus(BigInt.fromI32(1))
    } else {
      const oldBalance = balance.balance
      balance.balance = oldBalance.plus(amount)
      if (oldBalance.equals(BigInt.zero())) {
        recipient.tokenCount = recipient.tokenCount.plus(BigInt.fromI32(1))
      }
    }
    const transfer = new Transfer(
        call.transaction.hash.concatI32(call.transaction.index.toI32())
    )
    transfer.operator = call.from
    transfer.from = null
    transfer.to = recipientAddress
    transfer.token = tokenIdBytes
    transfer.blockNumber = call.block.number
    transfer.blockTimestamp = call.block.timestamp
    transfer.transactionHash = call.transaction.hash
    transfer.value = amount
    transfer.save()
    balance.save()
    recipient.save()
  }
  token.supply = totalSupply
  const configurationUrl = call.inputs.configuration
  token.configurationUrl = configurationUrl
  const configurationUrlParts = configurationUrl.split('/')
  const configurationIpfsHash = configurationUrlParts[configurationUrlParts.length - 1]
  token.configuration = Bytes.fromUTF8(configurationIpfsHash)
  FabricaTokenConfigurationTemplate.create(configurationIpfsHash)
  token.operatingAgreement = call.inputs.operatingAgreement
  token.validator = call.inputs.validator
  token.save()
}

export function handleMintBatch(call: MintBatchCall): void {
  for (let tokenIndex = 0; tokenIndex < call.outputs.ids.length; tokenIndex++) {
    const tokenId = call.outputs.ids[tokenIndex]
    const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
    let token = FabricaToken.load(tokenIdBytes)
    if (token != null) {
      throw new Error(`Mint call for token ${tokenId}, but token already exists`)
    }
    token = new FabricaToken(tokenIdBytes)
    const definitionUrl = call.inputs.definitions[tokenIndex]
    token.definitionUrl = definitionUrl
    const definitionUrlParts = definitionUrl.split('/')
    const definitionIpfsHash = definitionUrlParts[definitionUrlParts.length - 1]
    token.definition = Bytes.fromUTF8(definitionIpfsHash)
    FabricaTokenDefinitionTemplate.create(definitionIpfsHash)
    token.tokenId = tokenId
    let lastAmount = BigInt.zero()
    let totalSupply = BigInt.zero()
    for (let recipientIndex = 0; recipientIndex < call.inputs.recipients.length; recipientIndex++) {
      const recipientAddress = call.inputs.recipients[recipientIndex]
      if (LOAN_CONTRACT_ADDRESSES.includes(recipientAddress)) {
        continue
      }
      let recipient = Wallet.load(recipientAddress)
      if (recipient == null) {
        recipient = new Wallet(recipientAddress)
        recipient.address = recipientAddress
        recipient.tokenCount = BigInt.fromI32(1)
      }
      const amount = call.inputs.amounts[recipientIndex]
      if (amount.gt(lastAmount)) {
        token.creator = recipientAddress
      }
      lastAmount = amount
      totalSupply = totalSupply.plus(amount)
      const balanceId = recipientAddress.concat(recipientAddress).concat(tokenIdBytes)
      let balance = Balance.load(balanceId)
      if (balance == null) {
        balance = new Balance(balanceId)
        balance.token = tokenIdBytes
        balance.owner = recipientAddress
        balance.holder = recipientAddress
        balance.balance = amount
        recipient.tokenCount = recipient.tokenCount.plus(BigInt.fromI32(1))
      } else {
        const oldBalance = balance.balance
        balance.balance = oldBalance.plus(amount)
        if (oldBalance.equals(BigInt.zero())) {
          recipient.tokenCount = recipient.tokenCount.plus(BigInt.fromI32(1))
        }
      }
      const transfer = new Transfer(
          call.transaction.hash.concatI32(call.transaction.index.toI32()).concatI32(tokenIndex)
      )
      transfer.operator = call.from
      transfer.from = null
      transfer.to = recipientAddress
      transfer.token = tokenIdBytes
      transfer.blockNumber = call.block.number
      transfer.blockTimestamp = call.block.timestamp
      transfer.transactionHash = call.transaction.hash
      transfer.value = amount
      transfer.save()
      balance.save()
      recipient.save()
    }
    token.supply = totalSupply
    const configurationUrl = call.inputs.configurations[tokenIndex]
    token.configurationUrl = configurationUrl
    const configurationUrlParts = configurationUrl.split('/')
    const configurationIpfsHash = configurationUrlParts[configurationUrlParts.length - 1]
    token.configuration = Bytes.fromUTF8(configurationIpfsHash)
    FabricaTokenConfigurationTemplate.create(configurationIpfsHash)
    token.operatingAgreement = call.inputs.operatingAgreements[tokenIndex]
    token.validator = call.inputs.validators[tokenIndex]
    token.save()
  }
}

export function handleBatchTransferFrom(call: SafeBatchTransferFromCall): void {
  if (LOAN_CONTRACT_ADDRESSES.includes(call.inputs.from) ||
      LOAN_CONTRACT_ADDRESSES.includes(call.inputs.to)
  ) {
    return
  }
  for (let i = 0 ; i < call.inputs.ids.length ; i++) {
    const tokenId = call.inputs.ids[i]
    const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
    const transfer = new Transfer(
      call.transaction.hash.concatI32(call.transaction.index.toI32()).concatI32(i)
    )
    transfer.operator = call.from
    transfer.from = call.inputs.from
    transfer.to = call.inputs.to
    transfer.token = tokenIdBytes
    transfer.blockNumber = call.block.number
    transfer.blockTimestamp = call.block.timestamp
    transfer.transactionHash = call.transaction.hash
    transfer.value = call.inputs.amounts[i]
    transfer.save()
    let token = FabricaToken.load(tokenIdBytes)
    if (token == null) {
      throw new Error(`Transfer call for token ${tokenId}, but no token found`)
    }
    let from = Wallet.load(call.inputs.from)
    if (from == null) {
      throw new Error('Wallet doesn\'t exist for from address during token transfer')
    }
    if (from.tokenCount.lt(BigInt.fromI32(1))) {
      throw new Error('From wallet has zero tokenCount during token transfer')
    }
    const fromBalanceId = call.inputs.from.concat(call.inputs.from).concat(tokenIdBytes)
    let fromBalance = Balance.load(fromBalanceId)
    if (fromBalance == null) {
      throw new Error('Balance doesn\'t exist for from address')
    } else {
      const newBalance = fromBalance.balance.minus(call.inputs.amounts[i])
      fromBalance.balance = newBalance
      if (newBalance.equals(BigInt.zero())) {
        from.tokenCount = from.tokenCount.minus(BigInt.fromI32(1))
      }
    }
    fromBalance.save()
    from.save()
    let to = Wallet.load(call.inputs.to)
    if (to == null) {
      to = new Wallet(call.inputs.to)
      to.address = call.inputs.to
      to.tokenCount = BigInt.fromI32(1)
    } else {
      to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
    }
    const toBalanceId = call.inputs.to.concat(call.inputs.to).concat(tokenIdBytes)
    let toBalance = Balance.load(toBalanceId)
    if (toBalance == null) {
      toBalance = new Balance(toBalanceId)
      toBalance.token = tokenIdBytes
      toBalance.owner = call.inputs.to
      toBalance.holder = call.inputs.to
      toBalance.balance = call.inputs.amounts[i]
      to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
    } else {
      const oldBalance = toBalance.balance
      toBalance.balance = oldBalance.plus(call.inputs.amounts[i])
      if (oldBalance.equals(BigInt.zero())) {
        to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
      }
    }
    toBalance.save()
    to.save()
    token.save()
  }
}

export function handleTransferFrom(call: SafeTransferFromCall): void {
  if (LOAN_CONTRACT_ADDRESSES.includes(call.inputs.from) ||
      LOAN_CONTRACT_ADDRESSES.includes(call.inputs.to)
  ) {
    return
  }
  const tokenId = call.inputs.id
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
  const transfer = new Transfer(
    call.transaction.hash.concatI32(call.transaction.index.toI32())
  )
  transfer.operator = call.from
  transfer.from = call.inputs.from
  transfer.to = call.inputs.to
  transfer.token = tokenIdBytes
  transfer.blockNumber = call.block.number
  transfer.blockTimestamp = call.block.timestamp
  transfer.transactionHash = call.transaction.hash
  transfer.value = call.inputs.amount
  transfer.save()
  let token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Transfer call for token ${tokenId}, but no token found`)
  }
  let from = Wallet.load(call.inputs.from)
  if (from == null) {
    throw new Error('Wallet doesn\'t exist for from address during token transfer')
  }
  if (from.tokenCount.lt(BigInt.fromI32(1))) {
    throw new Error('From wallet has zero tokenCount during token transfer')
  }
  const fromBalanceId = call.inputs.from.concat(call.inputs.from).concat(tokenIdBytes)
  let fromBalance = Balance.load(fromBalanceId)
  if (fromBalance == null) {
    throw new Error('Balance doesn\'t exist for from address')
  } else {
    const newBalance = fromBalance.balance.minus(call.inputs.amount)
    fromBalance.balance = newBalance
    if (newBalance.equals(BigInt.zero())) {
      from.tokenCount = from.tokenCount.minus(BigInt.fromI32(1))
    }
  }
  fromBalance.save()
  from.save()
  const toBalanceId = call.inputs.to.concat(call.inputs.to).concat(tokenIdBytes)
  let toBalance = Balance.load(toBalanceId)
  let to = Wallet.load(call.inputs.to)
  if (to == null) {
    to = new Wallet(call.inputs.to)
    to.address = call.inputs.to
    to.tokenCount = BigInt.zero()
  }
  if (toBalance == null) {
    toBalance = new Balance(toBalanceId)
    toBalance.token = tokenIdBytes
    toBalance.owner = call.inputs.to
    toBalance.holder = call.inputs.to
    toBalance.balance = call.inputs.amount
    to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
  } else {
    const oldBalance = toBalance.balance
    toBalance.balance = oldBalance.plus(call.inputs.amount)
    if (oldBalance.equals(BigInt.zero())) {
      to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
    }
  }
  toBalance.save()
  to.save()
  token.save()
}

export function handleUpdateConfiguration(call: UpdateConfigurationCall): void {
  const tokenId = call.inputs.id
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
  const update = new ConfigurationUpdate(
      call.transaction.hash.concatI32(call.transaction.index.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = call.inputs.configuration
  update.blockNumber = call.block.number
  update.blockTimestamp = call.block.timestamp
  update.transactionHash = call.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.configurationUrl = call.inputs.configuration
  token.save()
}

export function handleUpdateOperatingAgreement(call: UpdateOperatingAgreementCall): void {
  const tokenId = call.inputs.id
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
  const update = new OperatingAgreementUpdate(
      call.transaction.hash.concatI32(call.transaction.index.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = call.inputs.operatingAgreement
  update.blockNumber = call.block.number
  update.blockTimestamp = call.block.timestamp
  update.transactionHash = call.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.operatingAgreement = call.inputs.operatingAgreement
  token.save()
}

export function handleUpdateValidator(call: UpdateValidatorCall): void {
  const tokenId = call.inputs.id
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(tokenId))
  const update = new ValidatorUpdate(
      call.transaction.hash.concatI32(call.transaction.index.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = call.inputs.validator
  update.blockNumber = call.block.number
  update.blockTimestamp = call.block.timestamp
  update.transactionHash = call.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.validator = call.inputs.validator
  token.save()
}

export function handleFabricaTokenDefinition(content: Bytes): void {
  const ipfsHash = dataSource.stringParam()
  const definitionId = Bytes.fromUTF8(ipfsHash)
  const definition = new FabricaTokenDefinition(definitionId)
  const rootNode = json.fromBytes(content)
  if (rootNode == null || rootNode.kind != JSONValueKind.OBJECT) {
    log.warning('Received definition from IPFS (CID {}), but there\'s no root node, or it\'s not an object', [ipfsHash])
    return
  }
  const rootObject = rootNode.toObject()
  const claimNode = rootObject.get('claim')
  if (claimNode == null || claimNode.kind != JSONValueKind.STRING) {
    log.warning('Missing or non-string claim from definition for CID {}', [ipfsHash])
    return
  }
  definition.claim = claimNode.toString()
  const coordinatesNode = rootObject.get('coordinates')
  if (coordinatesNode == null || coordinatesNode.kind != JSONValueKind.OBJECT) {
    log.warning('Missing or non-object coordinates from definition for CID {}', [ipfsHash])
    return
  }
  const coordinatesObject = coordinatesNode.toObject()
  const latNode = coordinatesObject.get('lat')
  const lat =
    latNode != null && latNode.kind == JSONValueKind.NUMBER
      ? BigDecimal.fromString(latNode.toF64().toString(10))
      : latNode != null && latNode.kind == JSONValueKind.STRING
        ? BigDecimal.fromString(latNode.toString())
        : null
  if (!lat) {
    log.warning('Missing or invalid definition.coordinates.lat for CID {}', [ipfsHash])
    return
  }
  const lonNode = coordinatesObject.get('lon')
  const lon =
    lonNode != null && lonNode.kind == JSONValueKind.NUMBER
      ? BigDecimal.fromString(lonNode.toF64().toString(10))
      : lonNode != null && lonNode.kind == JSONValueKind.STRING
        ? BigDecimal.fromString(lonNode.toString())
        : null
  if (!lon) {
    log.warning('Missing or invalid definition.coordinates.lon for CID {}', [ipfsHash])
    return
  }
  const coordinates = new Coordinates(definitionId)
  coordinates.lat = lat
  coordinates.lon = lon
  coordinates.save()
  definition.coordinates = definitionId
  const geoJsonNode = rootObject.get('geoJson')
  if (geoJsonNode != null && geoJsonNode.kind == JSONValueKind.OBJECT) {
    const geoJsonObject = geoJsonNode.toObject()
    const encoder = new JSONEncoder()
    encodeJsonObject(geoJsonObject, encoder)
    definition.geoJson = encoder.toString()
  }
  const holdingEntityNode = rootObject.get('holdingEntity')
  if (holdingEntityNode == null || holdingEntityNode.kind != JSONValueKind.STRING) {
    log.warning('Missing or invalid definition.coordinates.holdingEntity for CID {}', [ipfsHash])
    return
  }
  definition.holdingEntity = holdingEntityNode.toString()
  const offchainRegistrarNode = rootObject.get('offchainRegistrar')
  if (offchainRegistrarNode != null && offchainRegistrarNode.kind == JSONValueKind.OBJECT) {
    const offchainRegistrarObject = offchainRegistrarNode.toObject()
    const countryNode = offchainRegistrarObject.get('country')
    const adminNode = offchainRegistrarObject.get('admin')
    const adminIdNode = offchainRegistrarObject.get('adminId')
    const propertyIdNode = offchainRegistrarObject.get('propertyId')
    if (countryNode != null && countryNode.kind == JSONValueKind.STRING &&
      adminNode != null && adminNode.kind == JSONValueKind.STRING &&
      adminIdNode != null && adminIdNode.kind == JSONValueKind.STRING &&
      propertyIdNode != null && propertyIdNode.kind == JSONValueKind.STRING
    ) {
      const offchainRegistrar = new OffchainRegistrar(definitionId)
      offchainRegistrar.country = countryNode.toString()
      offchainRegistrar.admin = adminNode.toString()
      offchainRegistrar.adminId = adminIdNode.toString()
      offchainRegistrar.propertyId = propertyIdNode.toString()
      offchainRegistrar.save()
      definition.offchainRegistrar = definitionId
    }
  }
  definition.save()
}

export function handleFabricaTokenConfiguration(content: Bytes): void {
  const ipfsHash = dataSource.stringParam()
  const configurationId = Bytes.fromUTF8(ipfsHash)
  const configuration = new FabricaTokenConfiguration(configurationId)
  const rootNode = json.fromBytes(content)
  if (!rootNode || rootNode.kind != JSONValueKind.OBJECT) {
    log.warning('Received configuration from IPFS (CID {}), but there\'s no root node, or it\'s not an object', [ipfsHash])
    return
  }
  const rootObject = rootNode.toObject()
  const proofOfTitleNode = rootObject.get('proofOfTitle')
  if (proofOfTitleNode && proofOfTitleNode.kind == JSONValueKind.OBJECT) {
    const proofOfTitleObject = proofOfTitleNode.toObject()
    const proofOfTitle = new ProofOfTitle(configurationId)
    const documentNode = proofOfTitleObject.get('document')
    if (documentNode && documentNode.kind == JSONValueKind.STRING) {
      proofOfTitle.document = documentNode.toString()
    }
    const documentIdNode = proofOfTitleObject.get('documentId')
    if (documentIdNode && documentIdNode.kind == JSONValueKind.STRING) {
      proofOfTitle.documentId = documentIdNode.toString()
    }
    const sourceNode = proofOfTitleObject.get('source')
    if (sourceNode && sourceNode.kind == JSONValueKind.STRING) {
      proofOfTitle.documentId = sourceNode.toString()
    }
    configuration.proofOfTitle = configurationId
    proofOfTitle.save()
  }
  const propertyNickNameNode = rootObject.get('propertyNickName')
  if (propertyNickNameNode && propertyNickNameNode.kind == JSONValueKind.STRING) {
    configuration.propertyNickName = propertyNickNameNode.toString()
  }
  const userDescriptionNode = rootObject.get('userDescription')
  if (userDescriptionNode && userDescriptionNode.kind == JSONValueKind.STRING) {
    configuration.userDescription = userDescriptionNode.toString()
  }
  const mediaNode = rootObject.get('media')
  if (mediaNode && mediaNode.kind == JSONValueKind.ARRAY) {
    const mediaArray = mediaNode.toArray()
    for (let i = 0; i < mediaArray.length; i++) {
      const mediaItemNode = mediaArray[i]
      if (mediaItemNode && mediaItemNode.kind == JSONValueKind.OBJECT) {
        const mediaItemObject = mediaItemNode.toObject()
        const sourceNode = mediaItemObject.get('source')
        const typeNode = mediaItemObject.get('type')
        if (sourceNode && sourceNode.kind == JSONValueKind.STRING && typeNode && typeNode.kind == JSONValueKind.STRING) {
          const source = sourceNode.toString()
          const mediaItem = new FabricaTokenMedia(Bytes.fromUTF8(`${ipfsHash}:${source}`))
          mediaItem.configuration = configurationId
          mediaItem.source = source
          mediaItem.type = typeNode.toString()
          const descriptionNode = mediaItemObject.get('description')
          if (descriptionNode && descriptionNode.kind == JSONValueKind.STRING) {
            mediaItem.description = descriptionNode.toString()
          }
          const orderNode = mediaItemObject.get('order')
          if (orderNode && orderNode.kind == JSONValueKind.NUMBER) {
            mediaItem.order = BigDecimal.fromString(orderNode.toF64().toString(10))
          }
          mediaItem.save()
        }
      }
    }
  }
  const documentNode = rootObject.get('document')
  if (documentNode && documentNode.kind == JSONValueKind.ARRAY) {
    const documentArray = documentNode.toArray()
    for (let i = 0; i < documentArray.length; i++) {
      const documentItemNode = documentArray[i]
      if (documentItemNode && documentItemNode.kind == JSONValueKind.OBJECT) {
        const documentItemObject = documentItemNode.toObject()
        const sourceNode = documentItemObject.get('source')
        const typeNode = documentItemObject.get('type')
        if (sourceNode && sourceNode.kind == JSONValueKind.STRING && typeNode && typeNode.kind == JSONValueKind.STRING) {
          const source = sourceNode.toString()
          const documentItem = new FabricaTokenDocument(Bytes.fromUTF8(`${ipfsHash}:${source}`))
          documentItem.configuration = configurationId
          documentItem.source = source
          documentItem.type = typeNode.toString()
          const descriptionNode = documentItemObject.get('description')
          if (descriptionNode && descriptionNode.kind == JSONValueKind.STRING) {
            documentItem.description = descriptionNode.toString()
          }
          const orderNode = documentItemObject.get('order')
          if (orderNode && orderNode.kind == JSONValueKind.NUMBER) {
            documentItem.order = BigDecimal.fromString(orderNode.toF64().toString(10))
          }
          documentItem.save()
        }
      }
    }
  }
  const vendorNode = rootObject.get('vendor')
  if (vendorNode && vendorNode.kind == JSONValueKind.STRING) {
    configuration.vendor = vendorNode.toString()
  }
  const vendorIdNode = rootObject.get('vendorId')
  if (vendorIdNode && vendorIdNode.kind == JSONValueKind.STRING) {
    configuration.vendorId = vendorIdNode.toString()
  }
  configuration.save()
}

function encodeJsonObject(obj: TypedMap<string, JSONValue>, encoder: JSONEncoder): void {
  const nodes = obj.entries
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex]
    switch (node.value.kind) {
      case JSONValueKind.NULL:
        encoder.setNull(node.key)
        break
      case JSONValueKind.STRING:
        encoder.setString(node.key, node.value.toString())
        break
      case JSONValueKind.BOOL:
        encoder.setBoolean(node.key, node.value.toBool())
        break
      case JSONValueKind.NUMBER:
        encoder.setFloat(node.key, node.value.toF64())
        break
      case JSONValueKind.OBJECT:
        const obj = node.value.toObject()
        encoder.pushObject(node.key)
        encodeJsonObject(obj, encoder)
        encoder.popObject()
        break
      case JSONValueKind.ARRAY:
        const arr = node.value.toArray()
        encoder.pushArray(node.key)
          encodeJsonArray(arr, encoder)
        encoder.popArray()
    }
  }
}

function encodeJsonArray(arr: JSONValue[], encoder: JSONEncoder): void {
  for (let arrIndex = 0; arrIndex < arr.length; arrIndex++) {
    const val = arr[arrIndex]
    switch (val.kind) {
      case JSONValueKind.STRING:
        encoder. setString("", val.toString())
        break
      case JSONValueKind.BOOL:
        encoder.setBoolean("", val.toBool())
        break
      case JSONValueKind.NUMBER:
        encoder.setFloat("", val.toF64())
        break
      case JSONValueKind.OBJECT:
        const obj = val.toObject()
        encoder.pushObject("")
        encodeJsonObject(obj, encoder)
        encoder.popObject()
        break
      case JSONValueKind.ARRAY:
        const arr = val.toArray()
        encoder.pushArray("")
        encodeJsonArray(arr, encoder)
        encoder.popArray()
    }
  }
}
