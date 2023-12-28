import {Address, BigDecimal, BigInt, Bytes, dataSource, json, JSONValueKind} from '@graphprotocol/graph-ts'

import {
  FabricaToken as FabricaTokenContract,
  TransferBatch as TransferBatchEvent,
  TransferSingle as TransferSingleEvent,
  UpdateConfiguration as UpdateConfigurationEvent,
  UpdateOperatingAgreement as UpdateOperatingAgreementEvent,
  UpdateValidator as UpdateValidatorEvent,
  URI as UriEvent,
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
  UriUpdate,
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

export function handleTransferBatch(event: TransferBatchEvent): void {
  if (
      LOAN_CONTRACT_ADDRESSES.includes(event.params.from) ||
      LOAN_CONTRACT_ADDRESSES.includes(event.params.to)
  ) {
    return
  }
  for (let i = 0; i < event.params.ids.length; i++) {
    const tokenIdBytes = Bytes.fromByteArray(
        Bytes.fromBigInt(event.params.ids[i]),
    )
    const transfer = new Transfer(
        event.transaction.hash.concatI32(event.logIndex.toI32()).concatI32(i),
    )
    transfer.operator = event.params.operator
    transfer.from =
        event.params.from == Address.zero() ? null : event.params.from
    transfer.to = event.params.to == Address.zero() ? null : event.params.to
    transfer.token = tokenIdBytes
    transfer.blockNumber = event.block.number
    transfer.blockTimestamp = event.block.timestamp
    transfer.transactionHash = event.transaction.hash
    transfer.value = event.params.values[i]
    transfer.save()
    const tokenContract = FabricaTokenContract.bind(event.address)
    const properties = tokenContract._property(event.params.ids[i])
    let token = FabricaToken.load(tokenIdBytes)
    if (event.params.from == Address.zero()) {
      if (token != null) {
        throw new Error(
            `Mint event for token ${event.params.ids[i]}, but token already exists`,
        )
      }
      token = new FabricaToken(tokenIdBytes)
      token.creator = event.params.to
      const definitionUrl = properties.getDefinition()
      token.definitionUrl = definitionUrl
      const definitionUrlParts = definitionUrl.split('/')
      const definitionIpfsHash = definitionUrlParts[definitionUrlParts.length - 1]
      token.definition = Bytes.fromByteArray(Bytes.fromUTF8(definitionIpfsHash))
      FabricaTokenDefinitionTemplate.create(definitionIpfsHash)
      token.tokenId = event.params.ids[i]
      token.supply = event.params.values[i]
    } else {
      if (token == null) {
        throw new Error(
            `Transfer event for token ${event.params.ids[i]}, but no token found`,
        )
      }
      const from = Wallet.load(event.params.from)
      if (from == null) {
        throw new Error(
            "Wallet doesn't exist for from address during token transfer",
        )
      }
      if (from.tokenCount.lt(BigInt.fromI32(1))) {
        throw new Error('From user has zero tokenCount during token transfer')
      }
      const balanceId = event.params.from
          .concat(event.params.from)
          .concat(tokenIdBytes)
      const balance = Balance.load(balanceId)
      if (balance == null) {
        throw new Error("Balance doesn't exist for from address")
      } else {
        const newBalance = balance.balance.minus(event.params.values[i])
        balance.balance = newBalance
        if (newBalance.equals(BigInt.zero())) {
          from.tokenCount = from.tokenCount.minus(BigInt.fromI32(1))
        }
      }
      balance.save()
      from.save()
    }
    if (event.params.to == Address.zero()) {
      token.supply = token.supply.minus(event.params.values[i])
    } else {
      let to = Wallet.load(event.params.to)
      if (to == null) {
        to = new Wallet(event.params.to)
        to.address = event.params.to
        to.tokenCount = BigInt.fromI32(1)
      } else {
        to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
      }
      const balanceId = event.params.to
          .concat(event.params.to)
          .concat(tokenIdBytes)
      let balance = Balance.load(balanceId)
      if (balance == null) {
        balance = new Balance(balanceId)
        balance.token = tokenIdBytes
        balance.owner = event.params.to
        balance.holder = event.params.to
        balance.balance = event.params.values[i]
        to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
      } else {
        const oldBalance = balance.balance
        balance.balance = oldBalance.plus(event.params.values[i])
        if (oldBalance.equals(BigInt.zero())) {
          to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
        }
      }
      balance.save()
      to.save()
    }
    const configurationUrl = properties.getConfiguration()
    token.configurationUrl = configurationUrl
    const configurationUrlParts = configurationUrl.split('/')
    const configurationIpfsHash = configurationUrlParts[configurationUrlParts.length - 1]
    token.configuration = Bytes.fromByteArray(Bytes.fromUTF8(configurationIpfsHash))
    FabricaTokenConfigurationTemplate.create(configurationIpfsHash)
    token.operatingAgreement = properties.getOperatingAgreement()
    token.validator = properties.getValidator()
    const uriResult = tokenContract.try_uri(event.params.ids[i])
    token.uri = uriResult.reverted ? '' : uriResult.value
    token.save()
  }
}

export function handleTransferSingle(event: TransferSingleEvent): void {
  if (
      LOAN_CONTRACT_ADDRESSES.includes(event.params.from) ||
      LOAN_CONTRACT_ADDRESSES.includes(event.params.to)
  ) {
    return
  }
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(event.params.id))
  const transfer = new Transfer(
      event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  transfer.operator = event.params.operator
  transfer.from = event.params.from
  transfer.to = event.params.to
  transfer.token = tokenIdBytes
  transfer.blockNumber = event.block.number
  transfer.blockTimestamp = event.block.timestamp
  transfer.transactionHash = event.transaction.hash
  transfer.value = event.params.value
  transfer.save()
  const tokenContract = FabricaTokenContract.bind(event.address)
  const properties = tokenContract._property(event.params.id)
  let token = FabricaToken.load(tokenIdBytes)
  if (event.params.from == Address.zero()) {
    if (token == null) {
      token = new FabricaToken(tokenIdBytes)
      token.creator = event.params.to
      const definitionUrl = properties.getDefinition()
      token.definitionUrl = definitionUrl
      const definitionUrlParts = definitionUrl.split('/')
      const definitionIpfsHash = definitionUrlParts[definitionUrlParts.length - 1]
      token.definition = Bytes.fromByteArray(Bytes.fromUTF8(definitionIpfsHash))
      FabricaTokenDefinitionTemplate.create(definitionIpfsHash)
      token.supply = event.params.value
      token.tokenId = event.params.id
    }
  } else {
    if (token == null) {
      throw new Error(
          `Transfer event for token ${event.params.id}, but no token found`,
      )
    }
    const from = Wallet.load(event.params.from)
    if (from == null) {
      throw new Error(
          "Wallet doesn't exist for from address during token transfer",
      )
    }
    if (from.tokenCount.lt(BigInt.fromI32(1))) {
      throw new Error('From user has zero tokenCount during token transfer')
    }
    const balanceId = event.params.from
        .concat(event.params.from)
        .concat(tokenIdBytes)
    const balance = Balance.load(balanceId)
    if (balance == null) {
      throw new Error("Balance doesn't exist for from address")
    } else {
      const newBalance = balance.balance.minus(event.params.value)
      balance.balance = newBalance
      if (newBalance.equals(BigInt.zero())) {
        from.tokenCount = from.tokenCount.minus(BigInt.fromI32(1))
      }
    }
    balance.save()
    from.save()
  }
  if (event.params.to == Address.zero()) {
    token.supply = token.supply.minus(event.params.value)
  } else {
    const balanceId = event.params.to
        .concat(event.params.to)
        .concat(tokenIdBytes)
    let balance = Balance.load(balanceId)
    let to = Wallet.load(event.params.to)
    if (to == null) {
      to = new Wallet(event.params.to)
      to.address = event.params.to
      to.tokenCount = BigInt.zero()
    }
    if (balance == null) {
      balance = new Balance(balanceId)
      balance.token = tokenIdBytes
      balance.owner = event.params.to
      balance.holder = event.params.to
      balance.balance = event.params.value
      to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
    } else {
      const oldBalance = balance.balance
      balance.balance = oldBalance.plus(event.params.value)
      if (oldBalance.equals(BigInt.zero())) {
        to.tokenCount = to.tokenCount.plus(BigInt.fromI32(1))
      }
    }
    balance.save()
    to.save()
  }
  const configurationUrl = properties.getConfiguration()
  token.configurationUrl = configurationUrl
  const configurationUrlParts = configurationUrl.split('/')
  const configurationIpfsHash = configurationUrlParts[configurationUrlParts.length - 1]
  token.configuration = Bytes.fromByteArray(Bytes.fromUTF8(configurationIpfsHash))
  FabricaTokenConfigurationTemplate.create(configurationIpfsHash)
  token.operatingAgreement = properties.getOperatingAgreement()
  token.validator = properties.getValidator()
  const uriResult = tokenContract.try_uri(event.params.id)
  token.uri = uriResult.reverted ? '' : uriResult.value
  token.save()
}

export function handleUriChanged(event: UriEvent): void {
  const tokenIdBytes = Bytes.fromByteArray(Bytes.fromBigInt(event.params.id))
  const update = new UriUpdate(
      event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = event.params.value
  update.blockNumber = event.block.number
  update.blockTimestamp = event.block.timestamp
  update.transactionHash = event.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.uri = event.params.value
  token.save()
}

export function handleUpdateConfiguration(
    event: UpdateConfigurationEvent,
): void {
  const tokenIdBytes = Bytes.fromByteArray(
      Bytes.fromBigInt(event.params.param0),
  )
  const update = new ConfigurationUpdate(
      event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = event.params.newData
  update.blockNumber = event.block.number
  update.blockTimestamp = event.block.timestamp
  update.transactionHash = event.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.configurationUrl = event.params.newData
  token.save()
}

export function handleUpdateOperatingAgreement(
    event: UpdateOperatingAgreementEvent,
): void {
  const tokenIdBytes = Bytes.fromByteArray(
      Bytes.fromBigInt(event.params.param0),
  )
  const update = new OperatingAgreementUpdate(
      event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = event.params.newData
  update.blockNumber = event.block.number
  update.blockTimestamp = event.block.timestamp
  update.transactionHash = event.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.operatingAgreement = event.params.newData
  token.save()
}

export function handleUpdateValidator(event: UpdateValidatorEvent): void {
  const tokenIdBytes = Bytes.fromByteArray(
      Bytes.fromBigInt(event.params.tokenId),
  )
  const update = new ValidatorUpdate(
      event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  update.token = tokenIdBytes
  update.newValue = event.params.validator
  update.blockNumber = event.block.number
  update.blockTimestamp = event.block.timestamp
  update.transactionHash = event.transaction.hash
  update.save()
  const token = FabricaToken.load(tokenIdBytes)
  if (token == null) {
    throw new Error(`Unknown token ${tokenIdBytes}`)
  }
  token.validator = event.params.validator
  token.save()
}

export function handleFabricaTokenDefinition(content: Bytes): void {
  const ipfsHash = dataSource.stringParam()
  const definitionId = Bytes.fromByteArray(Bytes.fromUTF8(ipfsHash))
  const definition = new FabricaTokenDefinition(definitionId)
  definition.ipfsHash = ipfsHash
  const rootNode = json.fromBytes(content).toObject()
  if (rootNode) {
    const claimNode = rootNode.get('claim')
    if (claimNode) {
      definition.claim = claimNode.toString()
    }
    const coordinatesNode = rootNode.get('coordinates')
    if (coordinatesNode && coordinatesNode.kind == JSONValueKind.OBJECT) {
      const coordinatesObject = coordinatesNode.toObject()
      const latNode = coordinatesObject.get('lat')
      const lat =
          latNode && latNode.kind == JSONValueKind.NUMBER
              ? BigDecimal.fromString(latNode.toF64().toString(10))
              : latNode && latNode.kind === JSONValueKind.STRING
                ? BigDecimal.fromString(latNode.toString())
                : null
      const lonNode = coordinatesObject.get('lon')
      const lon =
          lonNode && lonNode.kind == JSONValueKind.NUMBER
              ? BigDecimal.fromString(lonNode.toF64().toString(10))
              : lonNode && lonNode.kind === JSONValueKind.STRING
                  ? BigDecimal.fromString(lonNode.toString())
                  : null
      if (!!lat && !!lon) {
        const coordinates = new Coordinates(definitionId)
        coordinates.lat = lat
        coordinates.lon = lon
        coordinates.save()
        definition.coordinates = definitionId
      }
    }
    const geoJsonNode = rootNode.get('geoJson')
    if (geoJsonNode) {
      definition.geoJson = geoJsonNode.toString()
    }
    const holdingEntityNode = rootNode.get('')
    if (holdingEntityNode) {
      definition.holdingEntity = holdingEntityNode.toString()
    }
    const offchainRegistrarNode = rootNode.get('offchainRegistrar')
    if (offchainRegistrarNode && offchainRegistrarNode.kind == JSONValueKind.OBJECT) {
      const offchainRegistrarObject = offchainRegistrarNode.toObject()
      const offchainRegistrar = new OffchainRegistrar(definitionId)
      const countryNode = offchainRegistrarObject.get('country')
      if (countryNode && countryNode.kind == JSONValueKind.STRING) {
        offchainRegistrar.country = countryNode.toString()
      }
      const adminNode = offchainRegistrarObject.get('admin')
      if (adminNode && adminNode.kind == JSONValueKind.STRING) {
        offchainRegistrar.admin = adminNode.toString()
      }
      const adminIdNode = offchainRegistrarObject.get('adminId')
      if (adminIdNode && adminIdNode.kind == JSONValueKind.STRING) {
        offchainRegistrar.adminId = adminIdNode.toString()
      }
      const propertyIdNode = offchainRegistrarObject.get('propertyId')
      if (propertyIdNode && propertyIdNode.kind == JSONValueKind.STRING) {
        offchainRegistrar.propertyId = propertyIdNode.toString()
      }
      offchainRegistrar.save()
      definition.offchainRegistrar = definitionId
    }
    definition.save()
  }
}

export function handleFabricaTokenConfiguration(content: Bytes): void {
  const ipfsHash = dataSource.stringParam()
  const rootNode = json.fromBytes(content).toObject()
  if (rootNode) {
    const configurationId = Bytes.fromByteArray(Bytes.fromUTF8(ipfsHash))
    const configuration = new FabricaTokenConfiguration(configurationId)
    configuration.ipfsHash = ipfsHash
    const proofOfTitleNode = rootNode.get('proofOfTitle')
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
    const propertyNickNameNode = rootNode.get('propertyNickName')
    if (propertyNickNameNode && propertyNickNameNode.kind == JSONValueKind.STRING) {
      configuration.propertyNickName = propertyNickNameNode.toString()
    }
    const userDescriptionNode = rootNode.get('userDescription')
    if (userDescriptionNode && userDescriptionNode.kind == JSONValueKind.STRING) {
      configuration.userDescription = userDescriptionNode.toString()
    }
    const mediaNode = rootNode.get('media')
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
    const documentNode = rootNode.get('document')
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
    const vendorNode = rootNode.get('vendor')
    if (vendorNode && vendorNode.kind == JSONValueKind.STRING) {
      configuration.vendor = vendorNode.toString()
    }
    const vendorIdNode = rootNode.get('vendorId')
    if (vendorIdNode && vendorIdNode.kind == JSONValueKind.STRING) {
      configuration.vendorId = vendorIdNode.toString()
    }
    configuration.save()
  }
}
